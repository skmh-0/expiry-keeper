export type Nutrition = {
  /** 代谢能 kcal/kg */
  metabolizableEnergy?: string;
  /** 粗蛋白 % */
  crudeProtein?: string;
  /** 粗脂肪 % */
  crudeFat?: string;
  /** 粗纤维 % */
  crudeFiber?: string;
  /** 粗灰分 % */
  crudeAsh?: string;
  /** 水分 % */
  moisture?: string;
  /** 牛磺酸 % 或 mg/kg */
  taurine?: string;
  /** 钙磷比，例如 1.2:1 */
  calciumPhosphorus?: string;
  /** 以下为旧字段，兼容历史数据 */
  energy?: string;
  protein?: string;
  fat?: string;
  carbohydrate?: string;
  sodium?: string;
};

/** 宠物分类：食品 4 类 + 非食品 2 类 */
export type PetCategory = 'dry' | 'wet' | 'freeze_dried' | 'fresh_raw' | 'medicine' | 'supplies';

/** 宠物档案 */
export type Pet = {
  id: string;
  name: string;
  species: 'cat' | 'dog' | 'other';
  breed?: string;
  /** 体重 kg */
  weightKg?: number;
  /** 界面输入单位，新档案默认斤 */
  weightUnit?: WeightUnit;
  /** 出生日期 YYYY-MM-DD */
  birthDate?: string;
  gender?: 'male' | 'female' | 'unknown';
  neutered?: boolean;
  /** 头像：emoji 或 dataURL */
  avatar?: string;
  /** 自定义头像在 IndexedDB photos 表里的键，二进制不进入数据快照 */
  avatarPhotoId?: string;
  /** 体重记录，阶段 1.5 先积累数据，不据此自动改动代谢系数 */
  weightHistory?: WeightRecord[];
  createdAt: number;
  updatedAt: number;
};

export type WeightRecord = {
  date: string;
  weightKg: number;
  createdAt: number;
};

/** 界面输入单位；内部始终用 kg 计算 */
export type WeightUnit = 'g' | 'jin' | 'kg';

/** 投喂记录：驱动 7 天摄入预警与消耗估算 */
export type FeedingLog = {
  id: string;
  petId?: string;
  itemId?: string;
  gtin?: string;
  grams: number;
  /** 投喂日期 YYYY-MM-DD */
  date: string;
  note?: string;
  createdAt: number;
};

export type FieldConfidence = Record<string, number>;

export type Sku = {
  gtin: string;
  name: string;
  brand: string;
  /** 品牌商 / 委托方 / 出品方，不等同于实际生产厂家 */
  brandOwner: string;
  manufacturer: string;
  scCode?: string;
  standardCode?: string;
  ingredientsRaw: string;
  /** 列表图标上显示的文字（默认取品牌名，可手动改） */
  iconLabel?: string;
  /** 商品分类（other 为旧数据兼容） */
  category?: PetCategory | 'other';
  /** 用途：主食 / 零食（干粮、湿粮下面的子分类） */
  kind?: 'staple' | 'snack';
  ingredients: string[];
  additives: string[];
  allergens: string[];
  storage?: string;
  shelfLifeText?: string;
  shelfLifeDays?: number;
  /** 商品查询库返回的保质期月数 */
  shelfLifeMonths?: number;
  /** 单包/整包净含量（克）；乘法规格只记录单包克重 */
  packageGrams?: number;
  nutrition?: Nutrition;
  source: 'manual' | 'api' | 'library';
  version: number;
  confidence: FieldConfidence;
  createdAt: number;
  updatedAt: number;
  /** 商品库字段投票是否已达可信阈值 */
  verified?: boolean;
};

export type PantryItem = {
  id: string;
  gtin: string;
  productionDate?: string;
  expiryDate?: string;
  /** 用户手动修改过到期日 */
  expiryHumanConfirmed?: boolean;
  quantity: number;
  unit: string;
  /** 件数（几袋/几件），不影响克数统计 */
  count?: number;
  location: string;
  /** 归属宠物；空 = 家庭公共 */
  petId?: string;
  openedAt?: string;
  /** 开封后到期日（按分类预设，可改） */
  openedExpiryDate?: string;
  /** 用完/结案的日期；有值表示已从库存归档到消耗记录 */
  finishedAt?: string;
  note?: string;
  /** 背标照片存在 IndexedDB 里，记录只留一个 id */
  photoId?: string;
  /** 老数据里内联的压缩照片；迁移到 IndexedDB 后会清掉 */
  photo?: string;
  seeded?: boolean;
  createdAt: number;
};

export type Settings = {
  apiKey: string;
  remindEnabled: boolean;
  remindDays: number;
  lastNotified?: string;
  /** 每个商品最后一次弹出当天提醒的日期，避免全局标记互相挡住 */
  notified?: Record<string, string>;
  /** 复验档位：auto 只在拿不准时复验，always 每次都复验，off 不复验 */
  verifyMode?: VerifyMode;
  /** 三类提醒的总开关与各自启用时间，用于“关闭期间不补推” */
  reminders?: ReminderSettings;
  /** 商品查询库地址；留空时跳过查库直接使用 AI */
  productApiUrl?: string;
  /** 商品查询库 HMAC 密钥；仅存 Android Keystore，不进入快照和备份 */
  productApiSecret: string;
};

export type VerifyMode = 'auto' | 'always' | 'off';

export type ReminderKind = 'expiry' | 'vaccine' | 'deworm';

export type ReminderSettings = {
  expiryEnabled: boolean;
  vaccineEnabled: boolean;
  dewormEnabled: boolean;
  /** 开关打开的时刻；due 早于这里的日程不补提醒 */
  enabledAt: Partial<Record<ReminderKind, number>>;
};

export type VaccineKind = 'combo' | 'rabies' | 'other';

export type Vaccination = {
  id: string;
  petId: string;
  vaccineName: string;
  vaccineKind?: VaccineKind;
  /** 接种日期 YYYY-MM-DD */
  doseDate: string;
  /** 包装/疫苗本标注的下次免疫日期 */
  nextDate?: string;
  clinic?: string;
  source: 'photo' | 'manual' | 'auto';
  /** 只有确认过的记录才进入正式疫苗本和提醒排程 */
  confirmed: true;
  /** 错过提醒的周数，最多 4 */
  missCount?: number;
  /** 照片在 IndexedDB photos 表的键 */
  photoId?: string;
  createdAt: number;
  updatedAt?: number;
};

export type DewormingType = 'internal' | 'external';

export type DewormingPlan = {
  id: string;
  petId: string;
  type: DewormingType;
  lastDate: string;
  nextDate: string;
  doneLog: string[];
  missCount: number;
  createdAt: number;
  updatedAt: number;
};

/** 照片角色：告诉模型哪张是喷码特写、哪张是配料表特写，比一堆无标注的图准得多 */
export type PhotoRole = 'back' | 'ingredients' | 'date' | 'front';

export type PhotoShot = { dataUrl: string; role: PhotoRole };

/** 归一化坐标（0-1），左上角为原点 */
export type Region = { x: number; y: number; w: number; h: number };

export type Regions = {
  /** region 所属照片序号，从 1 开始 */
  photoIndex?: number;
  ingredients?: Region;
  date?: Region;
};

export type CheckResult = {
  level: 'ok' | 'warn' | 'error';
  text: string;
};

export type RecognizeOutcome = {
  sku: Sku;
  checks: CheckResult[];
  notices: string[];
  engine: 'api' | 'manual' | 'library';
  /** 模型从包装上读到的日期，用于回填确认表单 */
  productionDate?: string;
  expiryDate?: string;
  /** 是否跑过第二轮复验 */
  verified?: boolean;
  /** 复验里被修正的字段名 */
  corrected?: string[];
  /** 复验后仍然没读清的字段，提醒用户补拍 */
  unclear?: string[];
};

export type ExpiryStatus = 'expired' | 'soon' | 'watch' | 'ok' | 'unknown';

/** 常用厂家（用户可增删） */
export type Maker = {
  name: string;
  city?: string;
  brands?: string;
};
