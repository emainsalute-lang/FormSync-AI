import assert from "node:assert/strict";
import test from "node:test";
import { isOwnerVisible } from "../lib/owner-scope";

test("authenticated owners cannot claim unowned or other users' records", () => {
  assert.equal(isOwnerVisible("athlete-a", "athlete-a", ["athlete-a"]), true);
  assert.equal(isOwnerVisible("athlete-b", "athlete-a", ["athlete-a"]), false);
  assert.equal(isOwnerVisible(undefined, "athlete-a", ["athlete-a"]), false);
  assert.equal(isOwnerVisible("local", "athlete-a", ["athlete-a"]), false);
});

test("coaches see only active linked athlete records, while local mode keeps legacy data", () => {
  assert.equal(isOwnerVisible("athlete-a", "coach", ["athlete-a"]), true);
  assert.equal(isOwnerVisible("athlete-b", "coach", ["athlete-a"]), false);
  assert.equal(isOwnerVisible("coach", "coach", ["athlete-a"]), true);
  assert.equal(isOwnerVisible(undefined, "local", ["local"]), true);
  assert.equal(isOwnerVisible("local", "local", ["local"]), true);
  assert.equal(isOwnerVisible("athlete-a", "local", ["local"]), false);
});
