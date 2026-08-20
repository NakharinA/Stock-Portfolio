export interface JwtPayload {
  /** User id. Named `sub` because that is what JWT calls the subject. */
  sub: string;
  email: string;
}
