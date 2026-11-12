import type { AppConfig } from "../config/index.js";
import type { Db } from "../db/index.js";
import { commitProgress, findProgress } from "../repositories/progress.repository.js";
import type { UserRow } from "../repositories/user.repository.js";
import { documentMissing, invalidFields, unauthorized } from "../utils/errors.js";
import {
  MAX_DEVICE_LENGTH,
  isValidDocument,
  normalizeMetadata,
  normalizeOptionalText,
  normalizePercentage,
  normalizeProgress,
  requireDevice,
} from "../utils/validation.js";
import type { AuthService } from "./auth.service.js";

const nowSeconds = () => Math.floor(Date.now() / 1000);

export interface SavedProgress {
  document: string;
  timestamp: number;
}

export class ProgressService {
  private readonly write: ReturnType<typeof commitProgress>;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
  ) {
    this.write = commitProgress(db);
  }

  save(
    user: UserRow,
    credential: string | undefined,
    body: Record<string, unknown>,
  ): SavedProgress {
    const document = body.document;
    if (!isValidDocument(document)) throw documentMissing();

    const progress = normalizeProgress(body.progress);
    const percentage = normalizePercentage(body.percentage);
    const device = requireDevice(body.device);
    const deviceId = normalizeOptionalText(body.device_id, MAX_DEVICE_LENGTH);
    const metadata = normalizeMetadata(body.metadata);
    if (progress === undefined || percentage === undefined) throw invalidFields();
    // 可选字段非法时按参考服务端行为忽略，而不是让整次同步失败并进入 4 周重试。
    if (deviceId === undefined || metadata === undefined) throw invalidFields();

    const timestamp = nowSeconds();
    this.write(
      {
        userId: user.id,
        document,
        progress,
        percentage,
        device,
        deviceId,
        metadata,
      },
      timestamp,
      this.config.maxHistoryPerBook,
      // K-PUT-6：认证与写入在同一事务内完成，账号在认证后被删除时不会复活数据。
      () => {
        if (!this.auth.verifyPair(user.username, credential)) throw unauthorized();
      },
    );
    return { document, timestamp };
  }

  /** 未知文档必须返回 200 + {}，客户端靠 percentage 字段缺席判断（K-GET-3）。 */
  get(user: UserRow, document: string): Record<string, unknown> {
    if (!isValidDocument(document)) return {};
    const row = findProgress(this.db, user.id, document);
    if (!row) return {};

    const response: Record<string, unknown> = {
      document: row.document,
      percentage: row.percentage,
      progress: row.progress,
      device: row.device,
      timestamp: row.updated_at,
    };
    if (row.device_id !== null) response.device_id = row.device_id;
    return response;
  }
}
