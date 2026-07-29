export interface TropeModule {
  readonly id: string;
  readonly name: string;
  readonly emotionalGoal: string;
  readonly readerPsychology: ReadonlyArray<string>;
  readonly suitableContexts: ReadonlyArray<string>;
  readonly requiredRoles: ReadonlyArray<string>;
  readonly requiredBeats: ReadonlyArray<string>;
  readonly requiredPayoffEffects: ReadonlyArray<string>;
  readonly forbiddenShortcuts: ReadonlyArray<string>;
  readonly failureModes: ReadonlyArray<string>;
}

const TROPE_NAMES = [
  ["public-evaluation-reversal", "公开评价反转", "压抑后的价值确认"],
  ["hidden-identity-reveal", "隐藏身份曝光", "身份差带来的认知重构"],
  ["underdog-victory", "越级胜利", "能力边界被主动突破"],
  ["desperate-comeback", "绝境翻盘", "失控局势重新获得主动权"],
  ["resource-contest", "资源争夺", "稀缺资源改变选择权"],
  ["first-ability-display", "能力首次展示", "核心卖点得到可验证展示"],
  ["rule-breaking", "规则破解", "理解和利用规则获得优势"],
  ["misunderstanding-cleared", "误会澄清", "关系认知被事实修正"],
  ["authority-recognition", "权威认可", "社会评价得到现实确认"],
  ["relationship-warming", "关系升温", "信任通过代价和选择增长"],
  ["revenge-settlement", "复仇清算", "长期债务获得实际结算"],
  ["secret-revelation", "秘密揭晓", "旧信息重新解释当前局势"],
  ["forced-cooperation", "敌人被迫合作", "利益结构迫使立场调整"],
  ["compensation-after-loss", "失去后的补偿", "损失转化为新能力或关系"],
  ["identity-misalignment", "身份错位反转", "表面身份与实际权力错位"],
] as const;

export const BUILTIN_TROPE_LIBRARY: ReadonlyArray<TropeModule> = TROPE_NAMES.map(([id, name, emotionalGoal]) => ({
  id,
  name,
  emotionalGoal,
  readerPsychology: ["先建立可理解的期待", "让阻力或误判真实生效", "延迟后以现实结果确认"],
  suitableContexts: ["与人物目标、关系或资源直接相关的场景"],
  requiredRoles: ["承受压力者", "制造阻力者", "能够确认结果的现实结构"],
  requiredBeats: ["期待建立", "真实压制或损失", "主动选择", "兑现", "结果确认", "后续影响"],
  requiredPayoffEffects: ["身份、资源、关系、权力或认知至少改变一项"],
  forbiddenShortcuts: ["只写震惊和围观", "靠巧合无代价获胜", "用作者宣布成功代替结果"],
  failureModes: ["铺垫不足", "主角不主动", "没有现实收益", "兑现后局势不变"],
}));

export function getTropeModule(id: string): TropeModule | null {
  return BUILTIN_TROPE_LIBRARY.find((trope) => trope.id === id) ?? null;
}
