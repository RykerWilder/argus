import io
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

from app import cli
from app.accounts import security
from app.accounts import store
from tests.support import STRONG, ArgusTestCase


def run(*argv, stdin=""):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch("sys.stdin", io.StringIO(stdin)), redirect_stdout(out), redirect_stderr(err):
        code = cli.main(list(argv))
    return code, out.getvalue(), err.getvalue()


class CliTests(ArgusTestCase):
    def test_add_list_password_disable_delete(self):
        code, out, _ = run("add-user", "Alice", "--password-stdin", "--name", "Alice R", "--email", "a@example.com", stdin=STRONG + "\n")
        self.assertEqual(code, 0)
        self.assertIn("'alice' created", out)
        self.assertTrue(os.path.exists(self.users_file))

        code, out, _ = run("list-users")
        self.assertEqual(code, 0)
        self.assertIn("alice", out)
        self.assertIn("active", out)

        code, _, _ = run("set-password", "alice", "--password-stdin", stdin="another long password\n")
        self.assertEqual(code, 0)

        self.assertEqual(run("disable-user", "alice")[0], 0)
        self.assertIn("disabled", run("list-users")[1])
        self.assertEqual(run("enable-user", "alice")[0], 0)

        store.set_api_key("alice", "abuseipdb", "abcd1234efgh")
        self.assertEqual(run("delete-user", "alice", "--yes")[0], 0)
        self.assertIn("No users yet", run("list-users")[1])

    def test_set_mfa(self):
        run("add-user", "alice", "--password-stdin", stdin=STRONG + "\n")
        code, out, _ = run("set-mfa", "Alice", "on")
        self.assertEqual((code, "required for 'alice'" in out), (0, True))
        self.assertTrue(store.get_user("alice").mfa_enabled)
        with open(self.users_file, encoding="utf-8") as handle:
            self.assertIn('"mfa"', handle.read())
        self.assertIn("2FA", run("list-users")[1])
        code, out, _ = run("set-mfa", "alice", "off")
        self.assertEqual((code, "totp delete" in out), (0, True))
        self.assertFalse(store.get_user("alice").mfa_enabled)
        self.assertNotIn("2FA", run("list-users")[1])
        self.assertEqual(run("set-mfa", "ghost", "on")[0], 1)
        with self.assertRaises(SystemExit):
            run("set-mfa", "alice", "maybe")

    def test_unwritable_database_folder_is_reported(self):
        blocker = os.path.join(self.tmp, "a-file")
        with open(blocker, "w") as handle:
            handle.write("x")
        os.environ["ARGUS_DB_PATH"] = os.path.join(blocker, "argus.db")
        from app import config
        config.reset_settings()
        code, _, err = run("list-users")
        self.assertEqual((code, "Cannot open the database" in err), (1, True))

    def test_errors_exit_with_status_1_and_a_message(self):
        run("add-user", "alice", "--password-stdin", stdin=STRONG + "\n")
        code, _, err = run("add-user", "alice", "--password-stdin", stdin=STRONG + "\n")
        self.assertEqual(code, 1)
        self.assertIn("already exists", err)
        code, _, err = run("add-user", "bob", "--password-stdin", stdin="short\n")
        self.assertEqual((code, "at least" in err), (1, True))
        self.assertEqual(run("set-password", "ghost", "--password-stdin", stdin=STRONG + "\n")[0], 1)
        self.assertEqual(run("delete-user", "ghost", "--yes")[0], 1)
        self.assertEqual(run("disable-user", "ghost")[0], 1)

    def test_delete_asks_for_the_username(self):
        run("add-user", "alice", "--password-stdin", stdin=STRONG + "\n")
        with mock.patch("builtins.input", return_value="no"):
            code, _, err = run("delete-user", "alice")
        self.assertEqual((code, "Cancelled" in err), (1, True))
        self.assertIsNotNone(store.get_user("alice"))
        with mock.patch("builtins.input", return_value="alice"):
            self.assertEqual(run("delete-user", "alice")[0], 0)

    def test_sync_rewrites_the_file(self):
        run("add-user", "alice", "--password-stdin", stdin=STRONG + "\n")
        os.remove(self.users_file)
        code, out, _ = run("sync")
        self.assertEqual(code, 0)
        self.assertIn("written", out)
        self.assertTrue(os.path.exists(self.users_file))

    def test_missing_configuration_is_reported(self):
        del os.environ["ARGUS_SECRET_KEY"]
        from app import config
        config.reset_settings()
        code, _, err = run("list-users")
        self.assertEqual((code, "ARGUS_SECRET_KEY" in err), (1, True))


if __name__ == "__main__":
    unittest.main()
