import { Link, useLocation } from "react-router-dom";
import ToolsMenu from "./ToolsMenu";
import { useAccount } from "../../lib/user/account";

interface LinkItem {
  id: string;
  label: string;
  to: string;
}

/** A header entry: a link or the tools dropdown. */
type HeaderItem = ({ menu?: false } & LinkItem) | { id: string; menu: true };

// Site navigation: the only place that decides which entries exist.
// To add, remove or rename an entry, change a line here:
// every page uses <Header /> and <Footer />, which read these lists.

/** Header entries, in the order they appear. */
export const HEADER_ITEMS: HeaderItem[] = [
  { id: "tools", menu: true },  // dropdown menu, see TOOLS in ToolsMenu.tsx
  { id: "history", label: "History", to: "/history" },
  { id: "settings", label: "Settings", to: "/settings" },
];

/** Footer entries. */
export const FOOTER_ITEMS: LinkItem[] = [{ id: "sources", label: "Sources", to: "/sources" }];

function isCurrent(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavLink({ item, className = "nav-link" }: { item: LinkItem; className?: string }) {
  const { pathname } = useLocation();
  const current = isCurrent(pathname, item.to);
  return (
    <Link
      to={item.to}
      className={`${className} ${current ? "is-current" : ""}`}
      aria-current={current ? "page" : undefined}
    >
      {item.label}
    </Link>
  );
}

/** Sign-out from the Authelia portal. Shown only if the backend knows the address (not in development without Authelia). */
function SignOut() {
  const account = useAccount();
  if (!account?.logoutUrl) return null;
  return (
    <a href={account.logoutUrl} className="nav-link" title={`Signed in as ${account.username}`}>
      Sign out
    </a>
  );
}

/** The header entries (to put inside <nav className="site-header__nav">). */
export function MainNav() {
  return (
    <>
      {HEADER_ITEMS.map((item) => (item.menu ? <ToolsMenu key={item.id} /> : <NavLink key={item.id} item={item} />))}
      <SignOut />
    </>
  );
}

/** The footer entries. */
export function FooterNav() {
  return (
    <nav className="site-footer__nav" aria-label="Footer">
      {FOOTER_ITEMS.map((item) => (
        <NavLink key={item.id} item={item} className="site-footer__link" />
      ))}
    </nav>
  );
}
