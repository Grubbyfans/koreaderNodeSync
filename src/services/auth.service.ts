import type { IncomingHttpHeaders } from "node:http";
import type { AppConfig } from "../config/index.js";
import type { Db } from "../db/index.js";
import {
  deleteUserCascade,
  findUserByUsername,
  insertUser,
  updateUserCredential,
  type UserRow,
} from "../repositories/user.repository.js";
import { hashCredential, verifyCredential } from "../utils/crypto.js";
import {
  accountNotFound,
  invalidFields,
  registrationDisabled,
  unauthorized,
  userExists,
} from "../utils/errors.js";
import {
  headerValue,
  isValidCredential,
  isValidUsername,
} from "../utils/validation.js";

const nowSeconds = () => Math.floor(Date.now() / 1000);

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  /** POST /users/create：password 已经是客户端算好的 MD5，不可再当明文哈希。 */
  register(body: Record<string, unknown>): string {
    if (!this.config.allowRegister) throw registrationDisabled();
    const { username, password } = body;
    if (!isValidUsername(username) || !isValidCredential(password)) throw invalidFields();
    const created = insertUser(this.db, username, hashCredential(password), nowSeconds());
    if (!created) throw userExists();
    return username;
  }

  verifyPair(username: string, credential: string | undefined): boolean {
    if (!isValidUsername(username) || !isValidCredential(credential)) return false;
    const user = findUserByUsername(this.db, username);
    return !!user && verifyCredential(credential, user.password_hash);
  }

  authenticate(headers: IncomingHttpHeaders): UserRow {
    const username = headerValue(headers, "x-auth-user");
    const credential = headerValue(headers, "x-auth-key");
    if (!isValidUsername(username) || !isValidCredential(credential)) throw unauthorized();
    const user = findUserByUsername(this.db, username);
    if (!user || !verifyCredential(credential, user.password_hash)) throw unauthorized();
    return user;
  }

  /** PUT /users/password（官方服务端可选端点，KOReader 客户端不调用）。 */
  changePassword(
    user: UserRow,
    currentKey: string | undefined,
    newCredential: unknown,
  ): void {
    if (!isValidCredential(newCredential)) throw invalidFields();
    this.db.transaction(() => {
      const fresh = findUserByUsername(this.db, user.username);
      if (!fresh || !verifyCredential(currentKey ?? "", fresh.password_hash)) {
        throw unauthorized();
      }
      updateUserCredential(this.db, fresh.id, hashCredential(newCredential as string));
    })();
  }

  /** DELETE /users/me（官方服务端可选端点，KOReader 客户端不调用）。 */
  deleteAccount(user: UserRow, currentKey: string | undefined): void {
    this.db.transaction(() => {
      const fresh = findUserByUsername(this.db, user.username);
      if (!fresh) throw accountNotFound();
      if (!verifyCredential(currentKey ?? "", fresh.password_hash)) throw unauthorized();
      deleteUserCascade(this.db)(fresh.id);
    })();
  }
}
