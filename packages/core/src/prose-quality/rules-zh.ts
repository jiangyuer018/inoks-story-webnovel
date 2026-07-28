/**
 * Adapted from worldwonderer/oh-story-claudecode story-deslop.
 * Original project licensed under the MIT License.
 * Rules and implementation were ported and adapted for Inoks Story Webnovel.
 */

export const PROSE_QUALITY_RULE_VERSION = "inoks-story-prose-zh/1.0.0";

export interface RegexRule {
  readonly id: string;
  readonly severity: "blocking" | "advisory" | "info";
  readonly category: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly suggestion: string;
  readonly narrativeOnly?: boolean;
  readonly endingOnly?: boolean;
}

export const BLOCKING_RULES: ReadonlyArray<RegexRule> = [
  {
    id: "not-is-comparison",
    severity: "blocking",
    category: "模板化否定翻转",
    pattern: /不是[^。！？!?\n，,]{1,40}(?:[，,；;：:]\s*)?(?:而)?是[^。！？!?\n]{1,50}/g,
    message: "命中“不是……而是/是……”模板化否定翻转。",
    suggestion: "删掉否定铺垫，直接写后项，或用动作与细节呈现。",
    narrativeOnly: true,
  },
  {
    id: "negative-positive-flip",
    severity: "blocking",
    category: "否定铺垫后肯定翻转",
    pattern: /(?:并非|并不是|绝非)[^。！？!?\n]{1,40}(?:[，,；;：:。]\s*)(?:真正|反倒|恰恰|其实)?是[^。！？!?\n]{1,50}/g,
    message: "否定铺垫后用肯定项翻转，呈现模板化解释腔。",
    suggestion: "直接写实际状态或现场后果。",
    narrativeOnly: true,
  },
  {
    id: "reverse-not-is",
    severity: "blocking",
    category: "反序否定比较",
    pattern: /(?<![还只可但于倒像若要正便总老更最算怕凡或即自竟原本仍许净光单尽])是[^。！？!?\n，,]{1,18}[，,]\s*(?:而)?不是[^。！？!?\n]{1,30}/g,
    message: "命中“是……不是……”反序模板。",
    suggestion: "删掉后置否定，直接写肯定项的具体表现。",
    narrativeOnly: true,
  },
  {
    id: "voice-contrast",
    severity: "blocking",
    category: "声音反差腔",
    pattern: /声音(?:并)?不[大高响亮][^。！？!?\n]{0,20}[却但偏][^。！？!?\n]{1,40}/g,
    message: "命中“声音不大/不高……却……”模板。",
    suggestion: "直接写声音造成的场内效果。",
    narrativeOnly: true,
  },
  {
    id: "negation-parade",
    severity: "blocking",
    category: "连续否定排比",
    pattern: /(?:没有[^。！？!?\n，,]{1,16}[，,]){2,}|没(?:有)?[^。！？!?\n，,]{1,16}[，,]\s*没(?:有)?[^。！？!?\n，,]{1,18}[，,。.][^。！？!?\n]{0,10}只(?:是|会|有)/g,
    message: "连续否定清单形成工整排比。",
    suggestion: "直接写现场实际存在的内容，最多保留一个必要否定。",
    narrativeOnly: true,
  },
  {
    id: "em-dash",
    severity: "blocking",
    category: "无功能长破折号",
    pattern: /——(?:换句话说|也就是说|这意味着|显然|当然|准确地说|更重要的是)[^。！？!?\n]{0,40}/g,
    message: "长破折号承载可直接删除的作者解释或总结。",
    suggestion: "删掉破折号后的无功能解释；需要的信息改由动作、物件或现场后果承担。",
    narrativeOnly: true,
  },
  {
    id: "trailer-ending",
    severity: "blocking",
    category: "预告式模板结尾",
    pattern: /没人知道|谁也不知道|谁也没想到|殊不知|(?:这)?才刚刚开(?:始|头)|属于[^。！？!?\n]{0,16}(?:反击|复仇|故事)[^。！？!?\n]{0,12}才刚刚开始|即将(?:开始|来临|降临)|(?<!正式)拉开(?:序幕|帷幕)/g,
    message: "章末出现预告、总结或升华模板。",
    suggestion: "停在具体动作、物件、台词或尚未解决的现场问题上。",
    narrativeOnly: true,
    endingOnly: true,
  },
];

export const CLICHE_PATTERN = /仿佛|犹如|宛若|如同|一丝|一抹|些许|几分|隐约|深吸一口气|缓缓|微微|轻轻|淡淡|眼中闪过|嘴角勾起|指节泛白|心中涌起一股|心头一震|心中暗道|不容置疑|显而易见|平静无波/g;
export const METAPHOR_PATTERN = /好像|像是|仿佛|宛如|如同|犹如|(?<![不头图画影录摄肖])像(?![头像素])/g;
export const MICRO_ACTION_PATTERN = /了(?:[一两三几半])?[下阵圈道声眼口气会]/g;
export const ACTION_LIST_PATTERN = /伸手|抬手|探手|拿起|拿过|取出|取过|掏出|摸出|抓起|攥住|握住|捏住|按住|推开|拉开|打开|关上|放下|递给|挑开|掀开|扯开|拧开|倒出|端起|转身|回头|抬头|低头|弯腰|俯身|走到|走向|坐下|站起|看向|看着|盯着|扫过/g;
export const REASONING_PATTERN = /(?<![不没未无])(?:他|她|我)?(?:知道|明白|意识到|清楚|判断|确认|分析)|这意味着|也就是说|换句话说|真正的问题(?:在于)?|问题在于|关键在于|想到这里|必须|需要/g;
export const ABSTRACT_PATTERN = /这一刻[，,]?[^\n。！？!?]{0,24}(?:终于|才)(?:明白|意识到)|从这一刻开始|(?:命运|宿命)[^\n。！？!?]{0,28}(?:齿轮|棋局|獠牙|改写|安排)|(?:反击|复仇|战争|较量|故事)[^\n。！？!?]{0,12}才刚刚开始/g;
export const TRANSITION_WORDS = ["然而", "不过", "与此同时", "另一方面", "尽管如此", "话虽如此", "但值得注意的是"] as const;
export const HEDGE_WORDS = ["似乎", "可能", "或许", "大概", "某种程度上", "一定程度上", "在某种意义上"] as const;
export const DIALOGUE_TAG_PATTERN = /(?:说|说道|问|问道|答|答道|笑道|冷声道|沉声道|低声道)[：:]?[“「『"]/g;
export const NATURAL_CONNECTIVES = ["的", "了", "就", "在", "是", "也", "都", "还", "又", "把", "被", "给", "因为", "所以", "但是", "不过", "然后", "已经", "之后", "没有"] as const;
