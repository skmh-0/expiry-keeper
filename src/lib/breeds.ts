import type { Pet } from '../types';

export type BreedEntry = {
  name: string;
  aliases: string[];
  initials?: string;
};

export type BreedSuggestion = BreedEntry & {
  reason: '常用' | '名称匹配' | '别名匹配' | '拼音匹配';
};

export const BREEDS: Record<'cat' | 'dog', BreedEntry[]> = {
  cat: [
    { name: '英国短毛猫', aliases: ['英短', '蓝猫'], initials: 'ygbm' },
    { name: '美国短毛猫', aliases: ['美短'], initials: 'mgbm' },
    { name: '布偶猫', aliases: ['布偶'], initials: 'bom' },
    { name: '金渐层', aliases: ['英短金渐层', '金渐层英短'], initials: 'jjc' },
    { name: '银渐层', aliases: ['英短银渐层', '银渐层英短'], initials: 'yjc' },
    { name: '缅因猫', aliases: ['缅因'], initials: 'mym' },
    { name: '狸花猫', aliases: ['狸花', '中华狸花猫'], initials: 'lhm' },
    { name: '橘猫', aliases: ['橘白', '黄狸'], initials: 'jm' },
    { name: '暹罗猫', aliases: ['暹罗'], initials: 'xlm' },
    { name: '苏格兰折耳猫', aliases: ['折耳猫', '折耳'], initials: 'sglzem' },
    { name: '曼基康矮脚猫', aliases: ['矮脚猫', '曼基康'], initials: 'mjkaijm' },
    { name: '加拿大无毛猫', aliases: ['斯芬克斯', '无毛猫'], initials: 'jndnwmm' },
    { name: '挪威森林猫', aliases: ['挪威森林'], initials: 'nwslm' },
    { name: '西伯利亚森林猫', aliases: ['西伯利亚猫', '西森'], initials: 'xblyslm' },
    { name: '波斯猫', aliases: ['波斯'], initials: 'bsm' },
    { name: '异国短毛猫', aliases: ['加菲猫', '加菲'], initials: 'ygdmm' },
    { name: '孟买猫', aliases: ['孟买'], initials: 'mmm' },
    { name: '孟加拉豹猫', aliases: ['豹猫', '孟加拉猫'], initials: 'mjglm' },
    { name: '阿比西尼亚猫', aliases: ['阿比', '阿比猫'], initials: 'abxnym' },
    { name: '俄罗斯蓝猫', aliases: ['俄蓝'], initials: 'elslm' },
    { name: '德文卷毛猫', aliases: ['德文猫', '德文'], initials: 'dwjmm' },
    { name: '柯尼斯卷毛猫', aliases: ['柯尼斯'], initials: 'knsjmm' },
    { name: '伯曼猫', aliases: ['伯曼'], initials: 'bmm' },
    { name: '巴厘猫', aliases: ['巴厘'], initials: 'blm' },
    { name: '土耳其安哥拉猫', aliases: ['安哥拉猫', '安哥拉'], initials: 'teqaglm' },
    { name: '土耳其梵猫', aliases: ['梵猫'], initials: 'teqfm' },
    { name: '日本短尾猫', aliases: ['日本短尾'], initials: 'rbdwm' },
    { name: '美国卷耳猫', aliases: ['卷耳猫'], initials: 'mgjem' },
    { name: '西伯利亚猫', aliases: ['西伯利亚'], initials: 'xblym' },
    { name: '沙特尔猫', aliases: ['夏特尔猫'], initials: 'stem' },
    { name: '新加坡猫', aliases: ['新加坡'], initials: 'xjpm' },
    { name: '埃及猫', aliases: ['埃及'], initials: 'ajm' },
    { name: '东方短毛猫', aliases: ['东方猫'], initials: 'dfdmm' },
    { name: '重点色短毛猫', aliases: ['重点色猫'], initials: 'zdsdmm' },
    { name: '山东狮子猫', aliases: ['狮子猫', '临清狮子猫'], initials: 'sdszm' },
    { name: '四川简州猫', aliases: ['简州猫'], initials: 'scjzm' },
    { name: '奶牛猫', aliases: ['黑白猫', '燕尾服猫'], initials: 'nnm' },
    { name: '三花猫', aliases: ['三花'], initials: 'shm' },
    { name: '玳瑁猫', aliases: ['玳瑁'], initials: 'dmm' },
    { name: '虎斑猫', aliases: ['虎斑'], initials: 'hbm' },
    { name: '玄猫', aliases: ['黑猫'], initials: 'xm' },
    { name: '白猫', aliases: ['大白猫'], initials: 'bm' },
    { name: '双色猫', aliases: ['双色'], initials: 'ssm' },
    { name: '异瞳白猫', aliases: ['异瞳猫', '鸳鸯眼'], initials: 'ytbm' },
    { name: '中华田园猫', aliases: ['田园猫', '土猫'], initials: 'zhtym' },
    { name: '长毛橘猫', aliases: ['长毛橘'], initials: 'cmjm' },
    { name: '长毛狸花', aliases: ['长毛狸花猫'], initials: 'cmlh' },
    { name: '蓝白猫', aliases: ['英短蓝白', '蓝白'], initials: 'lbm' },
    { name: '乳白猫', aliases: ['英短乳白', '乳白'], initials: 'rbm' },
    { name: '起司猫', aliases: ['加白美短', '起司'], initials: 'qsm' },
    { name: '重点色布偶', aliases: ['重点布偶'], initials: 'zdsbo' },
    { name: '双色布偶', aliases: ['双色布偶猫'], initials: 'ssbo' },
    { name: '手套布偶', aliases: ['手套色布偶'], initials: 'stbo' },
    { name: '梵色布偶', aliases: ['梵色'], initials: 'fsbo' },
    { name: '山猫纹布偶', aliases: ['山猫布偶'], initials: 'smwbo' },
  ],
  dog: [
    { name: '金毛寻回犬', aliases: ['金毛'], initials: 'jmxhq' },
    { name: '拉布拉多寻回犬', aliases: ['拉布拉多', '拉布'], initials: 'lbbdxhq' },
    { name: '威尔士柯基犬', aliases: ['柯基', '彭布罗克柯基'], initials: 'weskejq' },
    { name: '贵宾犬', aliases: ['泰迪', '贵宾'], initials: 'gbq' },
    { name: '边境牧羊犬', aliases: ['边牧'], initials: 'bjmyq' },
    { name: '德国牧羊犬', aliases: ['德牧'], initials: 'dgmyq' },
    { name: '西伯利亚雪橇犬', aliases: ['哈士奇', '二哈'], initials: 'xblyxqq' },
    { name: '阿拉斯加雪橇犬', aliases: ['阿拉斯加'], initials: 'alsjxqq' },
    { name: '萨摩耶犬', aliases: ['萨摩耶', '萨摩'], initials: 'smyq' },
    { name: '比熊犬', aliases: ['比熊'], initials: 'bxq' },
    { name: '博美犬', aliases: ['博美'], initials: 'bmq' },
    { name: '柴犬', aliases: ['柴狗'], initials: 'cq' },
    { name: '秋田犬', aliases: ['秋田'], initials: 'qtq' },
    { name: '中华田园犬', aliases: ['土狗', '田园犬'], initials: 'zhtyq' },
    { name: '法国斗牛犬', aliases: ['法斗'], initials: 'fgdnq' },
    { name: '英国斗牛犬', aliases: ['英斗'], initials: 'ygdnq' },
    { name: '巴哥犬', aliases: ['八哥犬', '巴哥'], initials: 'bgq' },
    { name: '雪纳瑞犬', aliases: ['雪纳瑞'], initials: 'xnrq' },
    { name: '约克夏梗', aliases: ['约克夏'], initials: 'ykxg' },
    { name: '马尔济斯犬', aliases: ['马尔济斯'], initials: 'mejsq' },
    { name: '吉娃娃犬', aliases: ['吉娃娃'], initials: 'jwwq' },
    { name: '腊肠犬', aliases: ['腊肠'], initials: 'lcq' },
    { name: '杜宾犬', aliases: ['杜宾'], initials: 'dbq' },
    { name: '罗威纳犬', aliases: ['罗威纳'], initials: 'lwnq' },
    { name: '比格犬', aliases: ['比格', '米格鲁'], initials: 'bgq' },
    { name: '巴吉度猎犬', aliases: ['巴吉度'], initials: 'bjdlq' },
    { name: '大白熊犬', aliases: ['大白熊'], initials: 'dbxq' },
    { name: '古代英国牧羊犬', aliases: ['古牧'], initials: 'gdygmyq' },
    { name: '松狮犬', aliases: ['松狮'], initials: 'ssq' },
    { name: '沙皮犬', aliases: ['沙皮'], initials: 'spq' },
    { name: '苏格兰牧羊犬', aliases: ['苏牧'], initials: 'sglmyq' },
    { name: '喜乐蒂牧羊犬', aliases: ['喜乐蒂', '喜乐蒂犬'], initials: 'xldmyq' },
    { name: '澳大利亚牧羊犬', aliases: ['澳牧'], initials: 'adlymyq' },
    { name: '澳大利亚牧牛犬', aliases: ['澳牛'], initials: 'adlmnq' },
    { name: '澳大利亚丝毛梗', aliases: ['澳丝'], initials: 'adlsmg' },
    { name: '大麦町犬', aliases: ['斑点狗', '大麦町'], initials: 'dmcq' },
    { name: '灵缇犬', aliases: ['灵缇', '格力犬'], initials: 'ltq' },
    { name: '惠比特犬', aliases: ['惠比特'], initials: 'hbtq' },
    { name: '阿富汗猎犬', aliases: ['阿富汗'], initials: 'afhlq' },
    { name: '萨路基猎犬', aliases: ['萨路基'], initials: 'sljlq' },
    { name: '牛头梗', aliases: ['牛头梗犬'], initials: 'ntg' },
    { name: '斗牛梗', aliases: ['牛头梗'], initials: 'dng' },
    { name: '贝灵顿梗', aliases: ['贝灵顿'], initials: 'bltg' },
    { name: '西高地白梗', aliases: ['西高地'], initials: 'xgdbg' },
    { name: '苏格兰梗', aliases: ['苏梗'], initials: 'sglg' },
    { name: '杰克罗素梗', aliases: ['杰克罗素'], initials: 'jklsg' },
    { name: '拳师犬', aliases: ['拳师'], initials: 'qsq' },
    { name: '波音达犬', aliases: ['波音达'], initials: 'bydq' },
    { name: '可卡犬', aliases: ['可卡'], initials: 'kkq' },
    { name: '英国史宾格犬', aliases: ['史宾格', '英系史宾格'], initials: 'ygsbgq' },
    { name: '杜高犬', aliases: ['杜高', '阿根廷杜高'], initials: 'dgq' },
    { name: '卡斯罗犬', aliases: ['卡斯罗'], initials: 'kslq' },
    { name: '马犬', aliases: ['比利时马林诺斯', '马林诺斯'], initials: 'mq' },
    { name: '昆明犬', aliases: ['昆明狼犬'], initials: 'kmq' },
    { name: '藏獒', aliases: ['西藏獒犬'], initials: 'za' },
    { name: '高加索犬', aliases: ['高加索'], initials: 'gjsq' },
    { name: '中亚牧羊犬', aliases: ['中亚犬', '中亚'], initials: 'zymyq' },
    { name: '中国狼青犬', aliases: ['狼青'], initials: 'zglqq' },
    { name: '黑狼犬', aliases: ['黑狼'], initials: 'hlq' },
    { name: '川东猎犬', aliases: ['川东犬'], initials: 'cdlq' },
    { name: '下司犬', aliases: ['下司'], initials: 'xsq' },
    { name: '中国细犬', aliases: ['细犬'], initials: 'zgxq' },
    { name: '法老王猎犬', aliases: ['法老王'], initials: 'flwlq' },
    { name: '意大利灵缇', aliases: ['意大利灵缇犬', '小灵缇'], initials: 'ydllt' },
    { name: '蝴蝶犬', aliases: ['蝶犬'], initials: 'hdq' },
    { name: '北京犬', aliases: ['京巴', '京巴犬'], initials: 'bjq' },
    { name: '西施犬', aliases: ['西施'], initials: 'xsq' },
    { name: '拉萨犬', aliases: ['拉萨'], initials: 'lsq' },
    { name: '比利时特弗伦犬', aliases: ['特弗伦'], initials: 'blstflq' },
    { name: '伯恩山犬', aliases: ['伯恩山'], initials: 'besq' },
    { name: '大丹犬', aliases: ['大丹'], initials: 'ddq' },
  ],
};

export function speciesBreedKey(species: Pet['species']): 'cat' | 'dog' | undefined {
  if (species === 'cat' || species === 'dog') return species;
  return undefined;
}

export function breedSuggestions(
  species: Pet['species'],
  query: string,
  limit = 8,
): BreedSuggestion[] {
  const key = speciesBreedKey(species);
  if (!key) return [];
  const needle = query.trim().toLowerCase().replace(/\s+/g, '');
  const rows = BREEDS[key];
  if (!needle) {
    return rows.slice(0, limit).map((entry) => ({ ...entry, reason: '常用' }));
  }
  const scored: { entry: BreedEntry; score: number; reason: BreedSuggestion['reason'] }[] = [];
  for (const entry of rows) {
    const name = entry.name.toLowerCase();
    const aliases = entry.aliases.map((alias) => alias.toLowerCase());
    const initials = (entry.initials ?? '').toLowerCase();
    let score = 0;
    let reason: BreedSuggestion['reason'] = '名称匹配';
    if (aliases.some((alias) => alias === needle)) {
      score = 110;
      reason = '别名匹配';
    } else if (name.startsWith(needle)) {
      score = 100;
    } else if (name.includes(needle)) {
      score = 85;
    } else if (aliases.some((alias) => alias.startsWith(needle))) {
      score = 78;
      reason = '别名匹配';
    } else if (aliases.some((alias) => alias.includes(needle))) {
      score = 65;
      reason = '别名匹配';
    } else if (initials.startsWith(needle)) {
      score = 55;
      reason = '拼音匹配';
    } else if (initials.includes(needle)) {
      score = 45;
      reason = '拼音匹配';
    }
    if (score) scored.push({ entry, score, reason });
  }
  return scored
    .sort((left, right) => right.score - left.score || rows.indexOf(left.entry) - rows.indexOf(right.entry))
    .slice(0, limit)
    .map(({ entry, reason }) => ({ ...entry, reason }));
}

