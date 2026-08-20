/** The slice of a Google profile this system actually uses. */
export interface GoogleProfile {
  googleSub: string;
  email: string;
  name?: string;
  /** Present only on the first consent, or when consent is re-prompted. */
  refreshToken?: string;
  scope: string;
}
