"""User management from the command line.

Inside the container:

    docker compose exec backend python -m app.cli add-user alice
    docker compose exec backend python -m app.cli set-password alice
    docker compose exec backend python -m app.cli set-mfa alice on      # or "off": second factor for that user
    docker compose exec backend python -m app.cli list-users
    docker compose exec backend python -m app.cli delete-user alice
    docker compose exec backend python -m app.cli sync

Every change to the users regenerates the file Authelia reads, and Authelia reloads it
by itself: nothing needs restarting. The password is asked for interactively (it does
not appear in the shell history); scripts can use --password-stdin.
"""
import argparse
import getpass
import sys
from typing import List, Optional

from app.accounts import store
from app.accounts.db import DatabaseError, init_db
from app.config import ConfigError, get_settings


def _password(args: argparse.Namespace) -> str:
    if args.password_stdin:
        return sys.stdin.readline().rstrip("\r\n")
    first = getpass.getpass("Password: ")
    if first != getpass.getpass("Repeat the password: "):
        raise store.StoreError("The two passwords do not match.")
    return first


def _add_user(args: argparse.Namespace) -> None:
    user = store.create_user(args.username, _password(args), display_name=args.name or "", email=args.email or "")
    print(f"User '{user.username}' created.")


def _set_password(args: argparse.Namespace) -> None:
    username = args.username.strip().lower()
    if store.get_user(username) is None:
        raise store.StoreError(f"The user '{username}' does not exist.")
    store.set_password(username, _password(args))
    print(f"Password of '{username}' changed.")


def _delete_user(args: argparse.Namespace) -> None:
    username = args.username.strip().lower()
    if not args.yes:
        answer = input(f"Delete '{username}' and their saved API keys? Type the username to confirm: ")
        if answer.strip().lower() != username:
            raise store.StoreError("Cancelled.")
    if not store.delete_user(username):
        raise store.StoreError(f"The user '{username}' does not exist.")
    print(f"User '{username}' deleted.")


def _set_disabled(disabled: bool):
    def run(args: argparse.Namespace) -> None:
        if not store.set_disabled(args.username, disabled):
            raise store.StoreError(f"The user '{args.username.strip().lower()}' does not exist.")
        print(f"User '{args.username.strip().lower()}' {'disabled' if disabled else 'enabled'}.")

    return run


def _set_mfa(args: argparse.Namespace) -> None:
    username = args.username.strip().lower()
    enabled = args.state == "on"
    if not store.set_mfa(username, enabled):
        raise store.StoreError(f"The user '{username}' does not exist.")
    print(f"Two-factor authentication {'required' if enabled else 'not required'} for '{username}'.")
    if not enabled:
        print("If they lost their device, also remove it: authelia storage user totp delete <username> (see the README).")


def _list_users(_: argparse.Namespace) -> None:
    users = store.list_users()
    if not users:
        print("No users yet. Create one with: python -m app.cli add-user <username>")
        return
    for u in users:
        print(f"{u.username:<24} {u.email:<32} {'disabled' if u.disabled else 'active':<9} {'2FA' if u.mfa_enabled else '-'}")


def _sync(_: argparse.Namespace) -> None:
    path = store.write_authelia_users()
    print(f"Authelia users file written: {path}" if path else "ARGUS_AUTHELIA_USERS_FILE is not set: nothing to write.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Manage Argus users.")
    sub = parser.add_subparsers(dest="command", required=True)

    def with_password(p: argparse.ArgumentParser) -> None:
        p.add_argument("--password-stdin", action="store_true", help="read the password from standard input")

    p = sub.add_parser("add-user", help="create a user")
    p.add_argument("username")
    p.add_argument("--name", help="display name (default: the username)")
    p.add_argument("--email", help="email address (default: <username>@argus.local)")
    with_password(p)
    p.set_defaults(run=_add_user)

    p = sub.add_parser("set-password", help="change a user's password")
    p.add_argument("username")
    with_password(p)
    p.set_defaults(run=_set_password)

    p = sub.add_parser("delete-user", help="delete a user and their API keys")
    p.add_argument("username")
    p.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    p.set_defaults(run=_delete_user)

    for name, disabled, text in (("disable-user", True, "block a user without deleting them"), ("enable-user", False, "unblock a user")):
        p = sub.add_parser(name, help=text)
        p.add_argument("username")
        p.set_defaults(run=_set_disabled(disabled))

    p = sub.add_parser("set-mfa", help="require (on) or not (off) a second factor from a user")
    p.add_argument("username")
    p.add_argument("state", choices=("on", "off"))
    p.set_defaults(run=_set_mfa)

    p = sub.add_parser("list-users", help="list the users")
    p.set_defaults(run=_list_users)

    p = sub.add_parser("sync", help="rewrite the users file that Authelia reads")
    p.set_defaults(run=_sync)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        get_settings()
        init_db()
        args.run(args)
    except (ConfigError, DatabaseError, store.StoreError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
