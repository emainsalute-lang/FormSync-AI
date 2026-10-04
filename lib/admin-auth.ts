import "server-only";
import { timingSafeEqual } from "node:crypto";

export function adminAuthorized(request: Request) {
  const expected = process.env.FORMSYNC_ADMIN_TOKEN;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
