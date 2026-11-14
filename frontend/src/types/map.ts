
/** A numbered stop on a route (for example a server an email went through). */
export interface RouteStop {
  lat: number;
  lon: number;
  countryCode?: string | null;
  label: string;
  title?: string;
}
