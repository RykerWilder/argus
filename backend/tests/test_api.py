import os
import unittest

from fastapi import Depends, FastAPI, Request

from app import config
from app.accounts import security
from app.accounts import store
from app.accounts.auth import require_user
from app.accounts import router as account
from app.lookups.keys import request_api_key
from tests.support import PROXY_SECRET, STRONG, ArgusTestCase, call, proxy_headers

KEY = "abcd1234efgh5678"


def build_app() -> FastAPI:
    """The account routes mounted as in main.py, plus a route that reads the key the way the source routers do."""
    app = FastAPI()
    protected = [Depends(require_user)]
    app.include_router(account.router, prefix="/api", dependencies=protected)

    @app.get("/api/probe/{service}", dependencies=protected)
    def probe(service: str, request: Request):
        return {"key": request_api_key(request, service)}

    return app


class AuthTests(ArgusTestCase):
    def setUp(self):
        super().setUp()
        store.create_user("alice", STRONG, display_name="Alice", email="alice@example.com")
        self.app = build_app()

    def get(self, headers):
        return call(self.app, "GET", "/api/me", headers)

    def test_requires_the_proxy_secret(self):
        self.assertEqual(self.get({})[0], 401)
        self.assertEqual(self.get({"Remote-User": "alice"})[0], 401)
        self.assertEqual(self.get(proxy_headers("alice", secret="x" * 40))[0], 401)
        self.assertEqual(self.get(proxy_headers("alice", secret=""))[0], 401)

    def test_requires_a_user(self):
        self.assertEqual(self.get(proxy_headers(None))[0], 401)
        self.assertEqual(self.get(proxy_headers("  "))[0], 401)

    def test_unknown_or_disabled_user_is_forbidden(self):
        self.assertEqual(self.get(proxy_headers("ghost"))[0], 403)
        store.set_disabled("alice", True)
        self.assertEqual(self.get(proxy_headers("alice"))[0], 403)

    def test_me(self):
        status, body = self.get(proxy_headers("alice"))
        self.assertEqual(status, 200)
        self.assertEqual(body, {
            "username": "alice", "displayName": "Alice", "email": "alice@example.com",
            "logoutUrl": "https://auth.argus.localhost/logout?rd=https%3A%2F%2Fargus.localhost%2F",
            "mfa": {"enabled": False, "required": False, "manageUrl": "https://auth.argus.localhost/settings"},
        })

    def test_user_name_is_case_insensitive(self):
        self.assertEqual(self.get(proxy_headers("Alice"))[0], 200)

    def test_logout_url_is_empty_when_not_configured(self):
        os.environ["ARGUS_AUTH_URL"] = ""
        config.reset_settings()
        self.assertEqual(self.get(proxy_headers("alice"))[1]["logoutUrl"], "")


class DevUserTests(ArgusTestCase):
    env_extra = {"ARGUS_DEV_USER": "alice", "ARGUS_PROXY_SECRET": ""}

    def test_dev_user_is_used_without_headers(self):
        store.create_user("alice", STRONG)
        status, body = call(build_app(), "GET", "/api/me")
        self.assertEqual((status, body["username"]), (200, "alice"))

    def test_dev_user_must_exist(self):
        self.assertEqual(call(build_app(), "GET", "/api/me")[0], 403)


class KeyTests(ArgusTestCase):
    def setUp(self):
        super().setUp()
        store.create_user("alice", STRONG)
        store.create_user("bob", STRONG)
        self.app = build_app()
        self.alice = proxy_headers("alice")
        self.bob = proxy_headers("bob")

    def test_full_flow(self):
        status, body = call(self.app, "GET", "/api/keys", self.alice)
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {"abuseipdb", "proxycheck", "virustotal"})
        self.assertFalse(any(v["configured"] for v in body.values()))

        status, body = call(self.app, "PUT", "/api/keys/abuseipdb", self.alice, {"key": f"  {KEY} "})
        self.assertEqual((status, body), (200, {"configured": True, "hint": KEY[-4:]}))
        self.assertNotIn(KEY, str(call(self.app, "GET", "/api/keys", self.alice)[1]))

        # the sources read the key of the user who made the request
        self.assertEqual(call(self.app, "GET", "/api/probe/abuseipdb", self.alice)[1], {"key": KEY})
        self.assertEqual(call(self.app, "GET", "/api/probe/abuseipdb", self.bob)[1], {"key": ""})
        self.assertEqual(call(self.app, "GET", "/api/probe/virustotal", self.alice)[1], {"key": ""})

        status, body = call(self.app, "DELETE", "/api/keys/abuseipdb", self.alice)
        self.assertEqual((status, body), (200, {"configured": False, "hint": None}))
        self.assertEqual(call(self.app, "GET", "/api/probe/abuseipdb", self.alice)[1], {"key": ""})

    def test_invalid_input(self):
        self.assertEqual(call(self.app, "PUT", "/api/keys/abuseipdb", self.alice, {"key": "short"})[0], 422)
        self.assertEqual(call(self.app, "PUT", "/api/keys/abuseipdb", self.alice, {"key": "has space in it!"})[0], 422)
        self.assertEqual(call(self.app, "PUT", "/api/keys/abuseipdb", self.alice, {})[0], 422)
        self.assertEqual(call(self.app, "PUT", "/api/keys/shodan", self.alice, {"key": KEY})[0], 404)
        self.assertEqual(call(self.app, "DELETE", "/api/keys/shodan", self.alice)[0], 404)

    def test_requires_login(self):
        self.assertEqual(call(self.app, "GET", "/api/keys")[0], 401)
        self.assertEqual(call(self.app, "PUT", "/api/keys/abuseipdb", {}, {"key": KEY})[0], 401)
        self.assertEqual(call(self.app, "GET", "/api/probe/abuseipdb")[0], 401)


class PasswordTests(ArgusTestCase):
    def setUp(self):
        super().setUp()
        account.reset_limits()
        store.create_user("alice", STRONG)
        self.app = build_app()
        self.alice = proxy_headers("alice")

    def test_change_updates_database_and_authelia_file(self):
        new = "another long password"
        status, body = call(self.app, "POST", "/api/me/password", self.alice, {"current": STRONG, "new": new})
        self.assertEqual((status, body), (200, {"ok": True}))
        with open(self.users_file, encoding="utf-8") as handle:
            text = handle.read()
        hashes = [line.split('"')[1] for line in text.splitlines() if "password:" in line]
        self.assertTrue(security.verify_password(new, hashes[0]))
        self.assertFalse(security.verify_password(STRONG, hashes[0]))

    def test_wrong_current_and_weak_new_are_refused(self):
        status, body = call(self.app, "POST", "/api/me/password", self.alice, {"current": "wrong password here", "new": "another long password"})
        self.assertEqual(status, 400)
        self.assertIn("current password", body["detail"])
        status, body = call(self.app, "POST", "/api/me/password", self.alice, {"current": STRONG, "new": "short"})
        self.assertEqual(status, 400)
        self.assertIn("at least", body["detail"])

    def test_requires_login(self):
        self.assertEqual(call(self.app, "POST", "/api/me/password", {}, {"current": STRONG, "new": "another long password"})[0], 401)

    def test_guessing_the_current_password_is_limited(self):
        wrong = {"current": "wrong password here", "new": "another long password"}
        for _ in range(account.MAX_WRONG_CURRENT):
            self.assertEqual(call(self.app, "POST", "/api/me/password", self.alice, wrong)[0], 400)
        # after the allowed attempts it locks, even with the right password
        status, body = call(self.app, "POST", "/api/me/password", self.alice, {"current": STRONG, "new": "another long password"})
        self.assertEqual(status, 429)
        self.assertIn("Try again", body["detail"])
        # it is a per-user limit
        store.create_user("bob", STRONG)
        status, _ = call(self.app, "POST", "/api/me/password", proxy_headers("bob"), {"current": STRONG, "new": "another long password"})
        self.assertEqual(status, 200)

    def test_weak_new_password_does_not_count_as_a_guess(self):
        for _ in range(account.MAX_WRONG_CURRENT + 1):
            self.assertEqual(call(self.app, "POST", "/api/me/password", self.alice, {"current": STRONG, "new": "short"})[0], 400)
        self.assertEqual(call(self.app, "POST", "/api/me/password", self.alice, {"current": STRONG, "new": "another long password"})[0], 200)

    def test_success_resets_the_counter(self):
        wrong = {"current": "wrong password here", "new": "another long password"}
        for _ in range(account.MAX_WRONG_CURRENT - 1):
            call(self.app, "POST", "/api/me/password", self.alice, wrong)
        self.assertEqual(call(self.app, "POST", "/api/me/password", self.alice, {"current": STRONG, "new": "another long password"})[0], 200)
        for _ in range(account.MAX_WRONG_CURRENT - 1):
            self.assertEqual(call(self.app, "POST", "/api/me/password", self.alice, {"current": "wrong password here", "new": "x" * 14})[0], 400)


class MfaTests(ArgusTestCase):
    def setUp(self):
        super().setUp()
        account.reset_limits()
        store.create_user("alice", STRONG)
        self.app = build_app()
        self.alice = proxy_headers("alice")

    def put(self, body, headers=None):
        return call(self.app, "PUT", "/api/me/mfa", self.alice if headers is None else headers, body)

    def mfa(self):
        return call(self.app, "GET", "/api/me", self.alice)[1]["mfa"]

    def in_authelia_file(self):
        with open(self.users_file, encoding="utf-8") as handle:
            return '"mfa"' in handle.read()

    def test_off_by_default(self):
        self.assertEqual(self.mfa(), {"enabled": False, "required": False, "manageUrl": "https://auth.argus.localhost/settings"})
        self.assertFalse(self.in_authelia_file())

    def test_turning_it_on_needs_no_password_and_reaches_authelia(self):
        status, body = self.put({"enabled": True})
        self.assertEqual(status, 200)
        self.assertTrue(body["enabled"])
        self.assertTrue(self.mfa()["enabled"])
        self.assertTrue(self.in_authelia_file())

    def test_turning_it_off_needs_the_password(self):
        self.put({"enabled": True})
        status, body = self.put({"enabled": False})
        self.assertEqual(status, 400)
        self.assertIn("current password", body["detail"])
        status, _ = self.put({"enabled": False, "password": "wrong password here"})
        self.assertEqual(status, 400)
        self.assertTrue(self.mfa()["enabled"])
        self.assertTrue(self.in_authelia_file())

        status, body = self.put({"enabled": False, "password": STRONG})
        self.assertEqual((status, body["enabled"]), (200, False))
        self.assertFalse(self.mfa()["enabled"])
        self.assertFalse(self.in_authelia_file())

    def test_repeating_the_current_state_changes_nothing(self):
        self.assertEqual(self.put({"enabled": False})[0], 200)  # already off: no password needed
        self.put({"enabled": True})
        self.assertEqual(self.put({"enabled": True})[0], 200)

    def test_guessing_the_password_to_turn_it_off_is_limited(self):
        self.put({"enabled": True})
        for _ in range(account.MAX_WRONG_CURRENT):
            self.assertEqual(self.put({"enabled": False, "password": "wrong password here"})[0], 400)
        status, body = self.put({"enabled": False, "password": STRONG})
        self.assertEqual(status, 429)
        self.assertIn("Try again", body["detail"])
        self.assertTrue(self.mfa()["enabled"])

    def test_it_is_per_user(self):
        store.create_user("bob", STRONG)
        self.put({"enabled": True})
        self.assertFalse(call(self.app, "GET", "/api/me", proxy_headers("bob"))[1]["mfa"]["enabled"])

    def test_validation_and_login(self):
        self.assertEqual(self.put({})[0], 422)
        self.assertEqual(self.put({"enabled": "maybe"})[0], 422)
        self.assertEqual(self.put({"enabled": True}, headers={})[0], 401)

    def test_manage_url_is_empty_when_the_portal_address_is_unknown(self):
        os.environ["ARGUS_AUTH_URL"] = ""
        config.reset_settings()
        self.assertEqual(self.mfa()["manageUrl"], "")


class RequiredMfaTests(ArgusTestCase):
    """With ARGUS_AUTH_POLICY=two_factor the second factor is mandatory for everyone and the user cannot change it."""

    env_extra = {"ARGUS_AUTH_POLICY": "two_factor"}

    def setUp(self):
        super().setUp()
        store.create_user("alice", STRONG)
        self.app = build_app()
        self.alice = proxy_headers("alice")

    def test_it_shows_as_required(self):
        mfa = call(self.app, "GET", "/api/me", self.alice)[1]["mfa"]
        self.assertEqual((mfa["enabled"], mfa["required"]), (True, True))

    def test_users_cannot_change_it(self):
        for body in ({"enabled": False, "password": STRONG}, {"enabled": True}):
            status, detail = call(self.app, "PUT", "/api/me/mfa", self.alice, body)
            self.assertEqual(status, 409, body)
            self.assertIn("required", detail["detail"])
        self.assertFalse(store.get_user("alice").mfa_enabled)


class PolicyConfigTests(ArgusTestCase):
    def test_default_is_one_factor(self):
        self.assertEqual(config.get_settings().auth_policy, "one_factor")

    def test_unknown_policy_stops_the_start(self):
        for value in ("three_factor", "TWO_FACTOR", "bypass"):
            os.environ["ARGUS_AUTH_POLICY"] = value
            config.reset_settings()
            with self.assertRaisesRegex(config.ConfigError, "ARGUS_AUTH_POLICY"):
                config.get_settings()


class PreferencesApiTests(ArgusTestCase):
    def setUp(self):
        super().setUp()
        store.create_user("alice", STRONG)
        store.create_user("bob", STRONG)
        self.app = build_app()
        self.alice = proxy_headers("alice")
        self.bob = proxy_headers("bob")

    def test_defaults_then_save_then_read(self):
        self.assertEqual(call(self.app, "GET", "/api/preferences", self.alice), (200, {"disabledSources": []}))
        status, body = call(self.app, "PUT", "/api/preferences", self.alice, {"disabledSources": ["shodan", "proxycheck"]})
        self.assertEqual((status, body), (200, {"disabledSources": ["proxycheck", "shodan"]}))
        self.assertEqual(call(self.app, "GET", "/api/preferences", self.alice)[1], body)
        self.assertEqual(call(self.app, "GET", "/api/preferences", self.bob)[1], {"disabledSources": []})

    def test_an_empty_request_changes_nothing(self):
        call(self.app, "PUT", "/api/preferences", self.alice, {"disabledSources": ["shodan"]})
        status, body = call(self.app, "PUT", "/api/preferences", self.alice, {})
        self.assertEqual((status, body), (200, {"disabledSources": ["shodan"]}))

    def test_invalid_input(self):
        for body in ({"disabledSources": "shodan"}, {"disabledSources": [1]}, {"disabledSources": ["Bad Id"]},
                     {"disabledSources": ["a" * 40]}, {"disabledSources": [f"s{i}" for i in range(65)]}):
            self.assertIn(call(self.app, "PUT", "/api/preferences", self.alice, body)[0], (422,), body)
        self.assertEqual(call(self.app, "GET", "/api/preferences", self.alice)[1], {"disabledSources": []})

    def test_requires_login(self):
        self.assertEqual(call(self.app, "GET", "/api/preferences")[0], 401)
        self.assertEqual(call(self.app, "PUT", "/api/preferences", {}, {"disabledSources": []})[0], 401)


class MainAppTests(ArgusTestCase):
    """main.py mounts everything: every /api route must ask for the user."""

    def test_every_api_route_requires_login(self):
        try:
            from app import main
        except ImportError as exc:  # source libraries (httpx, dnspython...) not installed
            self.skipTest(f"cannot import main: {exc}")
        from fastapi.routing import APIRoute

        checked = []
        for route in main.app.routes:
            if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
                continue
            for method in route.methods - {"HEAD", "OPTIONS"}:
                path = route.path.replace("{service}", "abuseipdb")
                status, _ = call(main.app, method, path, {}, {} if method in ("POST", "PUT", "PATCH") else None)
                self.assertEqual(status, 401, f"{method} {route.path} answered {status} without a login")
                checked.append((method, route.path))
        self.assertGreaterEqual(len(checked), 10, checked)

    def test_health_stays_open(self):
        try:
            from app import main
        except ImportError as exc:
            self.skipTest(f"cannot import main: {exc}")
        self.assertEqual(call(main.app, "GET", "/health"), (200, {"status": "ok"}))


if __name__ == "__main__":
    unittest.main()
