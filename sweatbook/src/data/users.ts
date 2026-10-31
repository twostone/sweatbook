import { isoNow, type Db } from "../db.ts";
import { newId } from "./common.ts";

export type Sex = "male" | "female";
export type User = { id: string; display_name: string | null; sex: Sex | null };

// The Home Assistant user (X-Remote-User-Id from ingress) mapped to our own id. Created on first sight; the display name
// follows HA. Own ids keep the data independent of HA: a later login without HA only adds another identity column.
export function resolveUser(db: Db, haUserId: string, displayName: string | null): User {
  const found = db.prepare("SELECT id, display_name, sex FROM app_user WHERE ha_user_id = ?").get(haUserId) as User | undefined;
  if (!found) {
    const user: User = { id: newId(), display_name: displayName, sex: null };
    db.prepare("INSERT INTO app_user (id, ha_user_id, display_name, created_at) VALUES (?, ?, ?, ?)").run(
      user.id,
      haUserId,
      displayName,
      isoNow(),
    );
    return user;
  }
  if (displayName !== null && displayName !== found.display_name) {
    db.prepare("UPDATE app_user SET display_name = ? WHERE id = ?").run(displayName, found.id);
    return { ...found, display_name: displayName };
  }
  return { id: found.id, display_name: found.display_name, sex: found.sex };
}

export function userSex(db: Db, userId: string): Sex | null {
  const row = db.prepare("SELECT sex FROM app_user WHERE id = ?").get(userId) as { sex: Sex | null } | undefined;
  return row?.sex ?? null;
}

// Which fixed weights plans show for this user (null = not set = the default weight).
export function setUserSex(db: Db, user: User, sex: Sex | null): User {
  db.prepare("UPDATE app_user SET sex = ? WHERE id = ?").run(sex, user.id);
  return { ...user, sex };
}
