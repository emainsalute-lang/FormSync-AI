export function isOwnerVisible(
  ownerId: string | undefined,
  actorId: string,
  accessibleOwnerIds: readonly string[],
) {
  if (actorId === "local") return !ownerId || ownerId === "local";
  return Boolean(
    ownerId && (ownerId === actorId || accessibleOwnerIds.includes(ownerId)),
  );
}
