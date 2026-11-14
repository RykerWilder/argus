import os
import re
import sqlite3
import stat
import unittest

from app.accounts import db
from app.accounts import security
from app.accounts import store
from tests.support import STRONG, ArgusTestCase

KEY = "abcd1234efgh5678"


class UserTests(ArgusTestCase):
    def test_create_normalizes_and_defaults(self):
        user = store.create_user("  Alice ", STRONG)
        self.assertEqual((user.username, user.display_name, user.email), ("alice", "alice", "alice@argus.local"))
        self.assertEqual(store.get_user("ALICE").username, "alice")
        self.assertEqual([u.username for u in store.list_users()], ["alice"])

    def test_password_is_never_stored_in_clear(self):
        store.create_user("alice", STRONG)
        with open(self.db_path, "rb") as handle:
            self.assertNotIn(STRONG.encode(), handle.read())
        with db.connection() as conn:
            stored = conn.execute("SELECT password_hash FROM users").fetchone()[0]
        self.assertTrue(security.verify_password(STRONG, stored))

    def test_rejects_bad_input(self):
        store.create_user("alice", STRONG)
        with self.assertRaisesRegex(store.StoreError, "already exists"):
            store.create_user("Alice", STRONG)
        for name in ("", "ab", "-alice", "al ice", "alice@x", "a" * 33, "../etc"):
            with self.assertRaises(store.StoreError, msg=name):
                store.create_user(name, STRONG)
        with self.assertRaisesRegex(store.StoreError, "at least"):
            store.create_user("bob", "short")
        with self.assertRaisesRegex(store.StoreError, "email"):
            store.create_user("bob", STRONG, email="not-an-email")

    def test_change_password(self):
        store.create_user("alice", STRONG)
        with self.assertRaisesRegex(store.StoreError, "current password"):
            store.change_password("alice", "wrong password here", "another long password")
        store.change_password("alice", STRONG, "another long password")
        with db.connection() as conn:
            stored = conn.execute("SELECT password_hash FROM users").fetchone()[0]
        self.assertTrue(security.verify_password("another long password", stored))
        self.assertFalse(security.verify_password(STRONG, stored))
        with self.assertRaisesRegex(store.StoreError, "at least"):
            store.change_password("alice", "another long password", "short")

    def test_set_password_unknown_user(self):
        with self.assertRaisesRegex(store.StoreError, "does not exist"):
            store.set_password("ghost", STRONG)

    def test_disable_and_delete(self):
        store.create_user("alice", STRONG)
        self.assertTrue(store.set_disabled("alice", True))
        self.assertTrue(store.get_user("alice").disabled)
        self.assertFalse(store.set_disabled("ghost", True))
        self.assertTrue(store.delete_user("alice"))
        self.assertFalse(store.delete_user("alice"))
        self.assertIsNone(store.get_user("alice"))


class ApiKeyTests(ArgusTestCase):
    def setUp(self):
        super().setUp()
        store.create_user("alice", STRONG)
        store.create_user("bob", STRONG)

    def test_save_read_replace_delete(self):
        self.assertIsNone(store.get_api_key("alice", "abuseipdb"))
        store.set_api_key("alice", "abuseipdb", KEY)
        self.assertEqual(store.get_api_key("alice", "abuseipdb"), KEY)
        store.set_api_key("alice", "abuseipdb", "zzzz9999yyyy")
        self.assertEqual(store.get_api_key("alice", "abuseipdb"), "zzzz9999yyyy")
        store.delete_api_key("alice", "abuseipdb")
        self.assertIsNone(store.get_api_key("alice", "abuseipdb"))

    def test_keys_are_per_user(self):
        store.set_api_key("alice", "virustotal", KEY)
        self.assertIsNone(store.get_api_key("bob", "virustotal"))

    def test_key_is_encrypted_at_rest(self):
        store.set_api_key("alice", "abuseipdb", KEY)
        with db.connection() as conn:
            blob = conn.execute("SELECT ciphertext FROM api_keys").fetchone()[0]
        self.assertNotIn(KEY.encode(), blob)
        for suffix in ("", "-journal"):
            path = self.db_path + suffix
            if os.path.exists(path):
                with open(path, "rb") as handle:
                    self.assertNotIn(KEY.encode(), handle.read())

    def test_moving_a_row_to_another_user_does_not_work(self):
        store.set_api_key("alice", "abuseipdb", KEY)
        with db.connection() as conn:
            conn.execute("UPDATE api_keys SET username = 'bob'")
        self.assertIsNone(store.get_api_key("bob", "abuseipdb"))

    def test_status_shows_only_the_last_four(self):
        store.set_api_key("alice", "proxycheck", KEY)
        status = store.key_status("alice")
        self.assertEqual(status["proxycheck"], {"configured": True, "hint": KEY[-4:]})
        self.assertEqual(status["abuseipdb"], {"configured": False, "hint": None})
        self.assertNotIn(KEY, str(status))

    def test_validation(self):
        for bad in ("", "short", "has space in it", "x" * 257, "semi;colon-key"):
            with self.assertRaises(store.StoreError, msg=bad):
                store.set_api_key("alice", "abuseipdb", bad)
        with self.assertRaisesRegex(store.StoreError, "Unknown service"):
            store.set_api_key("alice", "shodan", KEY)

    def test_deleting_a_user_deletes_their_keys(self):
        store.set_api_key("alice", "abuseipdb", KEY)
        store.delete_user("alice")
        with db.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM api_keys").fetchone()[0], 0)


class PreferencesTests(ArgusTestCase):
    def setUp(self):
        super().setUp()
        store.create_user("alice", STRONG)
        store.create_user("bob", STRONG)

    def test_defaults(self):
        self.assertEqual(store.get_preferences("alice"), {"disabledSources": []})

    def test_save_and_read_back(self):
        saved = store.set_preferences("alice", {"disabledSources": ["shodan", "abuseipdb", "shodan"]})
        self.assertEqual(saved, {"disabledSources": ["abuseipdb", "shodan"]})  # no duplicates, in order
        self.assertEqual(store.get_preferences("alice"), saved)
        self.assertEqual(store.set_preferences("alice", {"disabledSources": []}), {"disabledSources": []})

    def test_each_user_has_their_own(self):
        store.set_preferences("alice", {"disabledSources": ["shodan"]})
        self.assertEqual(store.get_preferences("bob"), {"disabledSources": []})
        self.assertEqual(store.get_preferences("ALICE")["disabledSources"], ["shodan"])

    def test_validation(self):
        for bad in ("shodan", [1], ["Shodan"], ["has space"], ["x" * 33], [""], ["a"] * 0 + ["ok", None], ["../etc"]):
            with self.assertRaises(store.StoreError, msg=repr(bad)):
                store.set_preferences("alice", {"disabledSources": bad})
        with self.assertRaises(store.StoreError):
            store.set_preferences("alice", {"disabledSources": [f"s{i}" for i in range(store.MAX_DISABLED_SOURCES + 1)]})
        with self.assertRaisesRegex(store.StoreError, "Unknown preference"):
            store.set_preferences("alice", {"theme": "dark"})
        # a wrong request changes nothing
        self.assertEqual(store.get_preferences("alice"), {"disabledSources": []})

    def test_unreadable_stored_value_falls_back_to_the_default(self):
        store.set_preferences("alice", {"disabledSources": ["shodan"]})
        with db.connection() as conn:
            conn.execute("UPDATE preferences SET value = 'not json'")
            conn.execute("INSERT INTO preferences VALUES ('alice', 'fromTheFuture', '1', '2026-01-01T00:00:00Z')")
        self.assertEqual(store.get_preferences("alice"), {"disabledSources": []})

    def test_deleting_a_user_deletes_their_preferences(self):
        store.set_preferences("alice", {"disabledSources": ["shodan"]})
        store.delete_user("alice")
        with db.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM preferences").fetchone()[0], 0)

    def test_verify_password(self):
        self.assertTrue(store.verify_password("alice", STRONG))
        self.assertFalse(store.verify_password("alice", "wrong password here"))
        self.assertFalse(store.verify_password("ghost", STRONG))


class AutheliaFileTests(ArgusTestCase):
    def read(self):
        with open(self.users_file, encoding="utf-8") as handle:
            return handle.read()

    def test_file_without_users_has_a_disabled_placeholder(self):
        # Authelia does not start with an empty list: a disabled user that nobody can use is needed
        store.write_authelia_users()
        text = self.read()
        self.assertIn(f'"{store.PLACEHOLDER_USER}":', text)
        self.assertIn("disabled: true", text)
        self.assertNotIn("disabled: false", text)
        self.assertIsNone(store.USERNAME_PATTERN.fullmatch(store.PLACEHOLDER_USER))
        # the placeholder's hash has the format of a real hash (Authelia reads it) but matches nothing
        self.assertFalse(security.verify_password("", store._PLACEHOLDER_HASH))
        self.assertIn(store._PLACEHOLDER_HASH, text)

    def test_placeholder_goes_away_with_the_first_user_and_returns_after_the_last(self):
        store.create_user("alice", STRONG)
        self.assertNotIn(store.PLACEHOLDER_USER, self.read())
        store.delete_user("alice")
        self.assertIn(store.PLACEHOLDER_USER, self.read())

    def test_file_follows_the_database(self):
        store.create_user("alice", STRONG, display_name='Alice "A" Rossi', email="alice@example.com")
        store.create_user("bob", STRONG)
        text = self.read()
        self.assertIn('"alice":', text)
        self.assertIn('"bob":', text)
        self.assertIn('displayname: "Alice \\"A\\" Rossi"', text)
        hashes = re.findall(r'password: "(\$argon2id[^"]+)"', text)
        self.assertEqual(len(hashes), 2)
        self.assertTrue(any(security.verify_password(STRONG, h) for h in hashes))
        store.set_disabled("bob", True)
        self.assertRegex(self.read(), r'"bob":\n    disabled: true')
        store.delete_user("alice")
        self.assertNotIn('"alice":', self.read())

    def test_mfa_users_join_the_mfa_group(self):
        store.create_user("alice", STRONG)
        store.create_user("bob", STRONG)
        self.assertNotIn('"mfa"', self.read())
        self.assertTrue(store.set_mfa("bob", True))
        text = self.read()
        self.assertEqual(text.count('"mfa"'), 1)
        self.assertRegex(text, r'"bob":(?:\n    .*)+\n      - "users"\n      - "mfa"')
        self.assertTrue(store.get_user("bob").mfa_enabled)
        self.assertFalse(store.get_user("alice").mfa_enabled)
        self.assertTrue(store.set_mfa("bob", False))
        self.assertNotIn('"mfa"', self.read())

    def test_set_mfa_for_unknown_user(self):
        self.assertFalse(store.set_mfa("ghost", True))

    def test_it_is_valid_yaml_if_pyyaml_is_available(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML not installed")
        store.create_user("alice", STRONG, display_name='Al: "ice" #1', email="alice@example.com")
        data = yaml.safe_load(self.read())
        entry = data["users"]["alice"]
        self.assertEqual(entry["displayname"], 'Al: "ice" #1')
        self.assertEqual(entry["email"], "alice@example.com")
        self.assertEqual(entry["groups"], ["users"])
        self.assertIs(entry["disabled"], False)
        self.assertTrue(security.verify_password(STRONG, entry["password"]))
        store.set_mfa("alice", True)
        self.assertEqual(yaml.safe_load(self.read())["users"]["alice"]["groups"], ["users", "mfa"])

    def test_write_is_atomic_and_leaves_no_temp_files(self):
        store.create_user("alice", STRONG)
        store.set_password("alice", "another long password")
        leftovers = [n for n in os.listdir(os.path.dirname(self.users_file)) if n != "users_database.yml"]
        self.assertEqual(leftovers, [])
        self.assertEqual(oct(os.stat(self.users_file).st_mode & 0o777), "0o644")

    def test_not_written_when_no_path_is_configured(self):
        os.environ["ARGUS_AUTHELIA_USERS_FILE"] = ""
        from app import config
        config.reset_settings()
        self.assertIsNone(store.write_authelia_users())


class DatabaseTests(ArgusTestCase):
    def test_file_is_private(self):
        self.assertEqual(oct(os.stat(self.db_path).st_mode & 0o777), "0o600")

    def test_init_is_idempotent_and_keeps_data(self):
        store.create_user("alice", STRONG)
        db.init_db()
        self.assertEqual(len(store.list_users()), 1)

    def test_newer_schema_is_refused(self):
        with db.connection() as conn:
            conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION + 1}")
        with self.assertRaisesRegex(db.DatabaseError, "newer Argus"):
            db.init_db()

    def test_database_is_a_single_file(self):
        # DELETE journal: no -wal/-shm next to the file, so moving it only takes copying it
        store.create_user("alice", STRONG)
        store.set_api_key("alice", "abuseipdb", KEY)
        self.assertEqual(sorted(os.listdir(self.tmp)), ["argus.db", "authelia"])
        conn = sqlite3.connect(self.db_path)
        try:
            self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "delete")
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], db.SCHEMA_VERSION)
        finally:
            conn.close()

    def test_a_copy_of_the_file_is_the_whole_database(self):
        # moving Argus = copying the file (with the same ARGUS_SECRET_KEY): users, keys and preferences are all there
        import shutil
        store.create_user("alice", STRONG)
        store.set_api_key("alice", "abuseipdb", KEY)
        store.set_mfa("alice", True)
        store.set_preferences("alice", {"disabledSources": ["shodan"]})
        moved = os.path.join(self.tmp, "moved.db")
        shutil.copyfile(self.db_path, moved)
        os.environ["ARGUS_DB_PATH"] = moved
        from app import config
        config.reset_settings()
        db.init_db()
        self.assertTrue(store.get_user("alice").mfa_enabled)
        self.assertEqual(store.get_api_key("alice", "abuseipdb"), KEY)
        self.assertEqual(store.get_preferences("alice")["disabledSources"], ["shodan"])

    def test_upgrade_from_schema_1_keeps_the_data(self):
        # a file created by Argus 2.2: schema 1, WAL journal, no mfa_enabled column
        os.remove(self.db_path)
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode = WAL")
        for statement in db._V1:
            conn.execute(statement)
        conn.execute(
            "INSERT INTO users VALUES ('alice', 'Alice', 'a@example.com', 'hash', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )
        conn.execute("INSERT INTO api_keys VALUES ('alice', 'abuseipdb', x'0102', '2026-01-01T00:00:00Z')")
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
        conn.close()

        db.init_db()

        user = store.get_user("alice")
        self.assertEqual((user.display_name, user.mfa_enabled), ("Alice", False))
        self.assertEqual(store.get_preferences("alice"), {"disabledSources": []})
        with db.connection() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM api_keys").fetchone()[0], 1)
            self.assertEqual(conn.execute("PRAGMA user_version").fetchone()[0], db.SCHEMA_VERSION)
            self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "delete")
        self.assertFalse(os.path.exists(self.db_path + "-wal"))
        db.init_db()  # a second time changes nothing
        self.assertEqual(len(store.list_users()), 1)

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "root can write anywhere")
    def test_unwritable_folder_gives_a_clear_error(self):
        folder = os.path.join(self.tmp, "locked")
        os.mkdir(folder)
        os.chmod(folder, stat.S_IRUSR | stat.S_IXUSR)
        os.environ["ARGUS_DB_PATH"] = os.path.join(folder, "argus.db")
        from app import config
        config.reset_settings()
        try:
            with self.assertRaisesRegex(db.DatabaseError, "Cannot (open|write to) the database"):
                db.init_db()
        finally:
            os.chmod(folder, stat.S_IRWXU)

    def test_folder_that_cannot_be_created_gives_a_clear_error(self):
        blocker = os.path.join(self.tmp, "a-file")
        with open(blocker, "w") as handle:
            handle.write("x")
        os.environ["ARGUS_DB_PATH"] = os.path.join(blocker, "sub", "argus.db")
        from app import config
        config.reset_settings()
        with self.assertRaisesRegex(db.DatabaseError, "Cannot open the database"):
            db.init_db()


if __name__ == "__main__":
    unittest.main()
