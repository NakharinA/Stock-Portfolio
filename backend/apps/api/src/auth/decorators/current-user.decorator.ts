import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { JwtPayload } from '../interface/jwt-payload/jwt-payload.interface';

/**
 * The authenticated user id, taken from the validated JWT. Controllers read the user from
 * here and never from a route parameter or body, so a request cannot ask for someone
 * else's data by naming them.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
  return request.user.sub;
});
