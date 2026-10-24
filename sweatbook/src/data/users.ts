import { isoNow, type Db } from "../db.ts";
import { newId } from "./common.ts";

export type User = { id: string; display_name: string | null };

// The Home Assistant user (X-Remote-User-Id from ingress) mapped to our own id. Created on first sight; the display name
// follows HA. Own ids keep the data independent of HA: a later login without HA only adds another identity column.
export function resolveUser(db: Db, haUserId: string, displayName: string | null): User {
  const found = db.prepare("SELECT id, display_name FROM app_user WHERE ha_user_id = ?").get(haUserId) as User | undefined;
  if (!found) {
    const user = { id: newId(), display_name: displayName };
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
  return { id: found.id, display_name: found.display_name };
}
