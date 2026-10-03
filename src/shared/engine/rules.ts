/**
 * Rule toggles. Every key mirrors the §12 table in RULES.md.
 */

export interface RuleOptions {
  /** 交换时同种货物不能同时拿走又交出 */
  exchangeSameTypeForbidden: boolean;
  /** 交换时能否从市场拿骆驼 */
  exchangeMayTakeCamels: boolean;
  /** 牌堆耗尽时本轮何时结束 */
  deckEndTrigger: 'refillFails' | 'deckEmpty';
  /** 骆驼并列最多时 5K 骆驼奖励归谁 */
  camelTie: 'none' | 'all';
  /** 总分、奖励枚数、货物枚数都相同时 */
  sealTie: 'none' | 'all';
  /** 下一轮先手 */
  nextRoundStarter: 'loser' | 'rotate';
  /** 整场长度 */
  matchLength: 'seals2' | 'single';
  /** 谁能看到奖励代币的面值 */
  bonusVisibility: 'owner' | 'hidden' | 'public';
  /** 其他人能否看到你有几头骆驼 */
  camelCountPublic: boolean;
  /** 能否翻看整个弃牌堆 */
  discardBrowsable: boolean;
  /** 联机回合计时（秒），0 为关闭 */
  turnTimer: 0 | 60 | 120;
}

export const DEFAULT_RULES: RuleOptions = {
  exchangeSameTypeForbidden: true,
  exchangeMayTakeCamels: false,
  deckEndTrigger: 'refillFails',
  camelTie: 'none',
  sealTie: 'none',
  nextRoundStarter: 'loser',
  matchLength: 'seals2',
  bonusVisibility: 'owner',
  camelCountPublic: true,
  discardBrowsable: true,
  turnTimer: 0,
};

export type RuleValue = RuleOptions[keyof RuleOptions];

export interface RuleMetaEntry {
  key: keyof RuleOptions;
  label: string;
  description: string;
  options: { value: RuleValue; label: string }[];
}

/** Ordered metadata for the rules UI. Strings follow the spec verbatim. */
export const RULE_META: RuleMetaEntry[] = [
  {
    key: 'exchangeSameTypeForbidden',
    label: '交换不可同种进出',
    description: '交换时不能交出与拿走种类相同的货物',
    options: [
      { value: true, label: '禁止（官方）' },
      { value: false, label: '允许' },
    ],
  },
  {
    key: 'exchangeMayTakeCamels',
    label: '交换可拿骆驼',
    description: '交换时能否从市场拿骆驼，拿走的骆驼进骆驼群',
    options: [
      { value: false, label: '不可以（官方）' },
      { value: true, label: '可以' },
    ],
  },
  {
    key: 'deckEndTrigger',
    label: '牌堆耗尽判定',
    description: '牌堆用完时本轮何时结束',
    options: [
      { value: 'refillFails', label: '补牌不够时结束（官方）' },
      { value: 'deckEmpty', label: '牌堆抽空即结束' },
    ],
  },
  {
    key: 'camelTie',
    label: '骆驼数相同',
    description: '双方骆驼一样多时，5K 骆驼奖励归谁',
    options: [
      { value: 'none', label: '都不得 5K（官方）' },
      { value: 'all', label: '双方各得 5K' },
    ],
  },
  {
    key: 'sealTie',
    label: '完全平局',
    description: '总分、奖励枚数、货物枚数都相同时',
    options: [
      { value: 'none', label: '本轮无人得印' },
      { value: 'all', label: '双方各得一印' },
    ],
  },
  {
    key: 'nextRoundStarter',
    label: '下一轮先手',
    description: '每轮由谁先行动',
    options: [
      { value: 'loser', label: '上一轮输家（官方）' },
      { value: 'rotate', label: '每轮交替' },
    ],
  },
  {
    key: 'matchLength',
    label: '整场长度',
    description: '打满几轮结束整场',
    options: [
      { value: 'seals2', label: '先得 2 印' },
      { value: 'single', label: '单轮' },
    ],
  },
  {
    key: 'bonusVisibility',
    label: '奖励代币面值',
    description: '谁能看到奖励代币的面值',
    options: [
      { value: 'owner', label: '仅持有者可见' },
      { value: 'hidden', label: '结算时才翻开' },
      { value: 'public', label: '全部公开' },
    ],
  },
  {
    key: 'camelCountPublic',
    label: '骆驼数量',
    description: '其他人能否看到你有几头骆驼',
    options: [
      { value: true, label: '公开' },
      { value: false, label: '隐藏（官方允许）' },
    ],
  },
  {
    key: 'discardBrowsable',
    label: '翻看弃牌堆',
    description: '能否翻看整个弃牌堆',
    options: [
      { value: true, label: '可以' },
      { value: false, label: '只看顶牌' },
    ],
  },
  {
    key: 'turnTimer',
    label: '回合计时（联机）',
    description: '超时由系统按平衡人格代走一步',
    options: [
      { value: 0, label: '关闭' },
      { value: 60, label: '60 秒' },
      { value: 120, label: '120 秒' },
    ],
  },
];
