import os
import re
import unittest

from app import config
from app.accounts import security
from tests.support import SECRET_KEY, STRONG, ArgusTestCase


class PasswordTests(ArgusTestCase):
    def test_hash_is_phc_argon2id_with_authelia_defaults(self):
        digest = security.hash_password(STRONG)
        self.assertRegex(digest, r"^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$")

    def test_verify(self):
        digest = security.hash_password(STRONG)
        self.assertTrue(security.verify_password(STRONG, digest))
        self.assertFalse(security.verify_password(STRONG + "x", digest))
        self.assertFalse(security.verify_password("", digest))

    def test_same_password_gives_different_hashes(self):
        self.assertNotEqual(security.hash_password(STRONG), security.hash_password(STRONG))

    def test_unreadable_hash_matches_nothing(self):
        for bad in ("", "plain", "$argon2id$v=19$m=1,t=1,p=1$abc", "$bcrypt$v=19$m=1,t=1,p=1$YQ$YQ", "$argon2id$v=19$m=x,t=1,p=1$YQ$YQ"):
            self.assertFalse(security.verify_password(STRONG, bad), bad)

    def test_policy(self):
        self.assertIsNone(security.check_password_policy(STRONG, "alice"))
        self.assertIn("at least", security.check_password_policy("short", "alice"))
        self.assertIn("at most", security.check_password_policy("x" * 129 + "yz", "alice"))
        self.assertIn("same as the username", security.check_password_policy("alice-alice1", "alice-alice1"))
        self.assertIn("repetitive", security.check_password_policy("aaaaaaaaaaaaaaaa", "bob"))


class SecretTests(ArgusTestCase):
    def test_roundtrip(self):
        blob = security.encrypt_secret("abcd1234efgh", username="alice", service="abuseipdb")
        self.assertNotIn(b"abcd1234efgh", blob)
        self.assertEqual(security.decrypt_secret(blob, username="alice", service="abuseipdb"), "abcd1234efgh")

    def test_each_encryption_is_different(self):
        a = security.encrypt_secret("abcd1234efgh", username="alice", service="abuseipdb")
        b = security.encrypt_secret("abcd1234efgh", username="alice", service="abuseipdb")
        self.assertNotEqual(a, b)

    def test_bound_to_user_and_service(self):
        blob = security.encrypt_secret("abcd1234efgh", username="alice", service="abuseipdb")
        self.assertIsNone(security.decrypt_secret(blob, username="bob", service="abuseipdb"))
        self.assertIsNone(security.decrypt_secret(blob, username="alice", service="virustotal"))

    def test_tampering_and_garbage_are_rejected(self):
        blob = bytearray(security.encrypt_secret("abcd1234efgh", username="alice", service="abuseipdb"))
        blob[-1] ^= 1
        self.assertIsNone(security.decrypt_secret(bytes(blob), username="alice", service="abuseipdb"))
        self.assertIsNone(security.decrypt_secret(b"", username="alice", service="abuseipdb"))
        self.assertIsNone(security.decrypt_secret(b"short", username="alice", service="abuseipdb"))

    def test_other_master_key_cannot_decrypt(self):
        blob = security.encrypt_secret("abcd1234efgh", username="alice", service="abuseipdb")
        os.environ["ARGUS_SECRET_KEY"] = "A" * 43 + "="  # 32 bytes different from the test ones
        config.reset_settings()
        self.assertIsNone(security.decrypt_secret(blob, username="alice", service="abuseipdb"))


class ConfigTests(ArgusTestCase):
    def test_secret_key_formats(self):
        self.assertEqual(len(config.decode_secret_key(SECRET_KEY)), 32)
        self.assertEqual(len(config.decode_secret_key(SECRET_KEY.replace("+", "-").replace("/", "_"))), 32)
        for bad in ("", "   ", "not base64!!", "QUJD", "A" * 100):
            with self.assertRaises(config.ConfigError, msg=bad):
                config.decode_secret_key(bad)

    def test_missing_secrets_stop_startup(self):
        del os.environ["ARGUS_PROXY_SECRET"]
        config.reset_settings()
        with self.assertRaisesRegex(config.ConfigError, "ARGUS_PROXY_SECRET"):
            config.get_settings()
        os.environ["ARGUS_PROXY_SECRET"] = "short"
        config.reset_settings()
        with self.assertRaisesRegex(config.ConfigError, "at least"):
            config.get_settings()
        os.environ["ARGUS_PROXY_SECRET"] = "p" * 40
        del os.environ["ARGUS_SECRET_KEY"]
        config.reset_settings()
        with self.assertRaisesRegex(config.ConfigError, "ARGUS_SECRET_KEY"):
            config.get_settings()

    def test_dev_user_does_not_need_proxy_secret(self):
        del os.environ["ARGUS_PROXY_SECRET"]
        os.environ["ARGUS_DEV_USER"] = " Alice "
        config.reset_settings()
        self.assertEqual(config.get_settings().dev_user, "alice")


if __name__ == "__main__":
    unittest.main()
