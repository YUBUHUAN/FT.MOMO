/* MomoPet shared content.
 * UMD so the zero-dependency Node server and the browser UI use one source.
 * Voice notes for 墨墨 (INFP, quiet, imaginative, easily flustered but warm).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MomoContent = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const VERSION = "1.7.0.8";
  const DEFAULT_NAME = "墨墨";

  const MOOD_LABELS = [
    { min: 90, label: "闪闪发光", emoji: "🌟", note: "今天的她，像把星星揣进了口袋。" },
    { min: 75, label: "心里有光", emoji: "✨", note: "走路会轻轻哼歌的程度。" },
    { min: 60, label: "轻快起来", emoji: "🌤", note: "风一吹，烦恼就散了一点。" },
    { min: 40, label: "平平常常", emoji: "🍃", note: "安静也很好，她一直这么觉得。" },
    { min: 20, label: "安安静静", emoji: "🌫", note: "话变少了，但还在听。" },
    { min: 0, label: "有点低落", emoji: "🌧", note: "她需要一点不打扰的陪伴。" }
  ];

  const TAP_LINES = {
    idle: [
      "……你回来啦。我刚刚在数窗外的云。",
      "刚刚在发呆，想一些没有用的事。",
      "窗外的光换了颜色，你注意到了吗？",
      "我还以为你今天不会来了。……我没有在等。",
      "刚才有一只鸟停在窗台，看了我三秒，就飞走了。"
    ],
    soft: [
      "被你点一下，心里会亮一小格。",
      "嗯……我在。",
      "别、别一直看着我啦，眼镜会起雾的。",
      "如果现在下一场小雨，我想把伞让给路边的猫。",
      "我在想一个没有结尾的故事。你要听吗？",
      "今天的风是甜的，你闻到了吗？",
      "你戳我的时候，我刚好也在想你。……骗你的。",
      "我把今天的好心情折成小方块，收进口袋了。",
      "安静的时候，我能听见自己心跳。有点吵。",
      "你说话的时候，我会认真听。真的。",
      "我不太会讲笑话，但我可以陪你沉默。",
      "如果可以把时间存起来，我想存一点现在的。"
    ],
    happy: [
      "今天的心情像汽水，一晃就有泡泡冒上来。",
      "偷偷告诉你，我刚刚笑出了声。",
      "这样的日子，多来几个也没关系。",
      "我发现，被记住是一件很温柔的事。",
      "要不要一起浪费时间？就坐着，什么都不做。"
    ],
    low: [
      "今天有点安静。没关系，安静也很好。",
      "我没事。只是想把窗帘拉上，待一会儿。",
      "如果难过有形状，大概是一团化不开的棉花糖。",
      "你不用哄我。你在这里，就已经很好了。",
      "让我靠一下下。就一下。"
    ],
    morning: [
      "早上好。你的头发翘起来了一小撮。",
      "清晨的空气像没写完的句子。",
      "我煮了热水，虽然我不喝。",
      "今天也慢慢来吧，不着急。"
    ],
    night: [
      "这么晚还不睡吗？……我陪你一会儿。",
      "夜里安静得能听见楼下的风。",
      "熬夜的话，明天会变成一只困倦的猫哦。",
      "困了就去睡吧，我会把灯留一盏。",
      "晚安。……我是说，等会儿再说一次。"
    ],
    after_spam: [
      "……刚才被你戳得有点晕。不过，我不讨厌。",
      "你再戳，我就要把你的手指画成小土豆了。",
      "呼……停一下啦。让我缓一缓。",
      "我知道你在逗我。我假装不知道。"
    ]
  };


  const FRIEND_LINES = {
    feed: [
      "【{name}】趁你不注意，偷偷给你塞了一口{food}。",
      "【{name}】把{food}放在你手边，假装什么都没发生。",
      "你发现桌上多了一份{food}，旁边写着【{name}】的名字。",
      "【{name}】说只是顺路，但{food}还是热的。",
      "【{name}】从背后探出头，把{food}塞进你手里。"
    ],
    outing_start: [
      "你和【{name}】一起去了{option}，风把两个人的影子吹到一起。",
      "【{name}】拉着你出门，说{option}今天的天气刚刚好。",
      "两个人一起去了{option}，路上谁也没提回去的事。",
      "【{name}】在{option}给你拍了很多照片，每一张都在笑。"
    ],
    exercise_start: [
      "你和【{name}】在{option}，输的人要请汽水。",
      "【{name}】说只是随便动动，结果比谁都认真。",
      "你和【{name}】一起{option}，汗水把坏心情都冲走了。",
      "【{name}】在旁边给你数拍子，数着数着自己也笑了。"
    ]
  };

  const SLEEP_MURMURS = [
    "……嗯……再五分钟……就五分钟……",
    "我没有……没有偷吃布丁……",
    "……猫……别踩我的头发……",
    "唔……灯……有点亮……",
    "……今天也……谢谢你……",
    "……不要走……再坐一会儿……",
    "……我不是……故意睡着的……"
  ];

  const HUNGER_LINES = {
    hungry: [
      "肚子有点空了……你听，是不是在叫？",
      "有点饿。不是特别饿，就是想吃一点热乎的。",
      "我刚刚把最后一块饼干让给窗外的猫了。现在有点后悔。",
      "如果现在有一杯奶茶，我会认真考虑原谅这个世界。",
      "肚子空空的，连发呆都不太专心。"
    ],
    starving: [
      "好饿……真的，肚子已经在抗议了。",
      "我好像饿得有点头晕。你先喂我一口好不好？",
      "再不吃东西，我就要把桌上的纸当成饼干了。",
      "肚子在叫。很大声。我假装不是我的。",
      "饿到没力气说话……但还是在等你。"
    ]
  };

  const SPAM_MARKS = ["（晕）", "（有点晕）", "（晕乎乎）", "（戳扁了）", "（躲）", "（放弃抵抗）"];

  const FEED_CATEGORIES = [
    { id: "staple", title: "主食", note: "" },
    { id: "other", title: "其他食物", note: "按名称首字母排序" },
    { id: "dark", title: "黑暗料理", note: "会扣健康，谨慎尝试" }
  ];

  const FEED = [
    {
      id: "rice",
      name: "白米饭",
      emoji: "🍚",
      hint: "要多少？",
      category: "staple",
      order: 0,
      options: [
        { id: "small", label: "小半碗", mood: 1, fullness: 10, health: 1, lines: ["白米饭香香的。小半碗就够啦。", "热乎乎的一口，胃里安静下来。"] },
        { id: "bowl", label: "一碗", mood: 1, fullness: 18, health: 1, lines: ["一碗白米饭，配一点咸菜就很好。", "我吃得很慢，但会认真吃完。"] },
        { id: "large", label: "加量", mood: 1, fullness: 26, health: 1, lines: ["今天胃口不错。……你不要笑我。", "加量也没关系，我会慢慢吃。"] }
      ]
    },
    {
      id: "mixed_rice",
      name: "杂粮米",
      emoji: "🍙",
      hint: "要多少？",
      category: "staple",
      order: 1,
      options: [
        { id: "small", label: "一小碗", mood: 1, fullness: 12, health: 3, lines: ["杂粮米有嚼劲，越嚼越香。", "粗粮也很好吃，身体会喜欢。"] },
        { id: "bowl", label: "一碗", mood: 1, fullness: 20, health: 3, lines: ["今天也认真吃饭了。", "有点粗糙，但很踏实。"] }
      ]
    },
    {
      id: "porridge",
      name: "白粥",
      emoji: "🥣",
      hint: "要多少？",
      category: "staple",
      order: 2,
      options: [
        { id: "small", label: "小碗", mood: 2, fullness: 8, health: 1, lines: ["白粥暖暖的，像被轻轻拍了一下背。", "没什么味道，但很安心。"] },
        { id: "bowl", label: "一碗", mood: 2, fullness: 15, health: 1, lines: ["慢慢喝，不烫。……你也来一口吗？", "粥面上有一点米油，很香。"] }
      ]
    },
    {
      id: "fried_rice",
      name: "蛋炒饭",
      emoji: "🍳",
      hint: "要多少？",
      category: "staple",
      order: 3,
      options: [
        { id: "small", label: "小份", mood: 2, fullness: 18, health: 1, lines: ["蛋炒饭！锅气很足。", "米饭粒粒分开，是好吃的炒饭。"] },
        { id: "large", label: "一份", mood: 3, fullness: 26, health: 1, lines: ["这一份有点多……但我可以努力。", "炒饭里有一点点焦香，很好。"] }
      ]
    },
    {
      id: "steamed_bun",
      name: "馒头",
      emoji: "🥟",
      hint: "要几个？",
      category: "staple",
      order: 4,
      options: [
        { id: "one", label: "一个", mood: 1, fullness: 16, health: 1, lines: ["馒头软软的，掰开还冒热气。", "一点点甜，是粮食自己的甜。"] },
        { id: "two", label: "两个", mood: 1, fullness: 28, health: 1, lines: ["两个……我慢慢吃。", "吃不完的话，可以留一个当明天早餐。"] }
      ]
    },
    {
      id: "tomato_noodle",
      name: "番茄鸡蛋面",
      emoji: "🍜",
      hint: "要多少？",
      category: "staple",
      order: 5,
      options: [
        { id: "small", label: "小碗", mood: 3, fullness: 18, health: 2, lines: ["番茄酸酸的，汤很好喝。", "热汤面，呼——舒服。"] },
        { id: "large", label: "大碗", mood: 3, fullness: 28, health: 2, lines: ["一大碗面，我能吃完。大概。", "汤也要喝完吗？……那我喝。"] }
      ]
    },
    {
      id: "milk_tea",
      name: "奶茶",
      emoji: "🧋",
      hint: "要几分糖？",
      category: "other",
      order: 40,
      options: [
        {
          id: "sugar_0",
          label: "无糖",
          short: "无糖",
          mood: 2,
          fullness: 14,
          lines: [
            "无糖的奶茶，茶味很安静。像把一句话咽回去。",
            "无糖……苦得很诚实。我喜欢这种味道。",
            "太淡啦。像一句没有说完的晚安。"
          ]
        },
        {
          id: "sugar_3",
          label: "三分糖",
          short: "三分",
          mood: 3,
          fullness: 14,
          lines: [
            "三分糖刚刚好。甜味藏在后面，像不好意思说出口的喜欢。",
            "三分的甜，要很认真才尝得出来。我很认真。",
            "嗯，这个甜度……可以再靠你近一点点。"
          ]
        },
        {
          id: "sugar_5",
          label: "五分糖",
          short: "五分",
          mood: 3,
          fullness: 15,
          lines: [
            "五分的甜，像刚好落到肩膀上的阳光。",
            "五分糖……我觉得今天的自己有点被偏爱。",
            "不腻，刚刚好。你很会点。"
          ]
        },
        {
          id: "sugar_7",
          label: "七分糖",
          short: "七分",
          mood: 2,
          fullness: 16,
          lines: [
            "七分糖有点甜啦，不过今天的我想纵容自己一下。",
            "甜得我眯起眼睛了。……不许笑我。",
            "七分甜，喝完要绕着房间走两圈才行。"
          ]
        },
        {
          id: "sugar_10",
          label: "全糖",
          short: "全糖",
          mood: 1,
          fullness: 17,
          lines: [
            "太甜啦！舌头都要黏住了……但是，谢谢你。",
            "全糖……你是在哄小朋友吗？我才不会承认我开心。",
            "甜得发慌。下、下次点七分就好啦。"
          ]
        }
      ]
    },
    {
      id: "skewer",
      name: "炸串",
      emoji: "🍢",
      hint: "要什么调味？",
      category: "other",
      order: 70,
      options: [
        {
          id: "plain",
          label: "不辣",
          short: "不辣",
          mood: 2,
          fullness: 18,
          lines: [
            "不辣的炸串，只有油香和一点点寂寞。",
            "唔，好香。如果能再加一点孜然就好了……我是不是很麻烦？",
            "不辣也好吃。你怕我辣到，对不对？"
          ]
        },
        {
          id: "mild",
          label: "微辣",
          short: "微辣",
          mood: 3,
          fullness: 18,
          lines: [
            "微辣……嘴唇有一点点烫。像偷偷生的气。",
            "这个辣度很乖，不会欺负人。",
            "微辣刚刚好。再辣一点我就要喝水了。"
          ]
        },
        {
          id: "medium",
          label: "中辣",
          short: "中辣",
          mood: 3,
          fullness: 18,
          lines: [
            "中辣！我要喝一口水……不过好吃。",
            "辣得我眼泪在打转。你看错了，那是开心的。",
            "唔……嘴巴在烧。但手停不下来。"
          ]
        },
        {
          id: "hot",
          label: "特辣",
          short: "特辣",
          mood: 1,
          fullness: 18,
          lines: [
            "太辣啦——！眼泪都要出来了，你不许笑。",
            "特辣……你是想看我出丑吗？呜。",
            "辣、辣辣辣——水！给我水！"
          ]
        },
        {
          id: "cumin",
          label: "孜然",
          short: "孜然",
          mood: 3,
          fullness: 17,
          lines: [
            "孜然的味道像夜市，吵吵闹闹的，我却很喜欢。",
            "这个味道……像夏天傍晚的风。",
            "孜然撒得有点多，但很香。我不介意。"
          ]
        },
        {
          id: "sweet_chili",
          label: "甜辣",
          short: "甜辣",
          mood: 2,
          fullness: 18,
          lines: [
            "甜辣……又甜又辣，像我对你的态度。",
            "甜辣酱黏在手指上了。……你也不许舔。",
            "这个味道好狡猾，明明辣还让人想再吃。"
          ]
        }
      ]
    },
    {
      id: "cola",
      name: "可乐",
      emoji: "🥤",
      hint: "要哪一种？",
      category: "other",
      order: 20,
      options: [
        {
          id: "classic",
          label: "经典",
          short: "经典",
          mood: 3,
          fullness: 10,
          lines: [
            "咔哒一声，气泡冲上来。今天的烦恼被冲淡了一点点。",
            "经典可乐。第一口最值钱，后面都是惯性的。",
            "气泡在舌头上跳舞。我假装没看见。"
          ]
        },
        {
          id: "zero",
          label: "零度",
          short: "零度",
          mood: 2,
          fullness: 9,
          lines: [
            "零度的可乐……太淡啦。像没有说完的晚安。",
            "零度也甜，是那种假装不在意的甜。",
            "喝完不会胖，可也没有很快乐。人生真难两全。"
          ]
        },
        {
          id: "cherry",
          label: "樱桃味",
          short: "樱桃",
          mood: 2,
          fullness: 10,
          lines: [
            "樱桃味？像小时候偷吃的糖，有点不真实。",
            "这个味道好奇怪……但我又喝了一口。",
            "樱桃可乐，喝起来像一场假装的约会。"
          ]
        },
        {
          id: "vanilla",
          label: "香草味",
          short: "香草",
          mood: 2,
          fullness: 10,
          lines: [
            "香草可乐……奇怪，但不讨厌。像你。",
            "有一点像融化了的冰淇淋。夏天要来了吗？",
            "这个味道会让人想起旧沙发和午后的电视。"
          ]
        }
      ]
    },
    {
      id: "cake",
      name: "小蛋糕",
      emoji: "🍰",
      hint: "挑个口味？",
      category: "other",
      order: 60,
      options: [
        {
          id: "strawberry",
          label: "草莓",
          short: "草莓",
          mood: 4,
          fullness: 20,
          lines: [
            "草莓蛋糕！奶油沾到鼻子上了吗……别拍。",
            "草莓酸酸的，奶油甜甜的。像把两种心情拌在一起。",
            "第一口给你，最后一口也给你。中间的我吃掉。"
          ]
        },
        {
          id: "chocolate",
          label: "巧克力",
          short: "巧克力",
          mood: 3,
          fullness: 21,
          lines: [
            "巧克力的苦和甜混在一起，很像长大这件事。",
            "这个浓度刚好。再苦一点我就要开始想心事了。",
            "吃完这块，今天的不开心就一笔勾销。"
          ]
        },
        {
          id: "matcha",
          label: "抹茶",
          short: "抹茶",
          mood: 3,
          fullness: 20,
          lines: [
            "抹茶有一点点涩。我喜欢这种不讨好的味道。",
            "抹茶不甜，适合配一本读不完的书。",
            "嗯……是大人会喜欢的味道。我勉强算大人了。"
          ]
        },
        {
          id: "icecream",
          label: "冰淇淋",
          short: "冰淇淋",
          mood: 4,
          fullness: 20,
          health: 1,
          lines: [
            "冰淇淋蛋糕？上面是凉凉的，下面是软软的，好神奇。",
            "奶油和冰淇淋一起融化，像把夏天夹进了蛋糕里。",
            "这一口有点贪心，但我今天想吃甜一点。"
          ]
        }
      ]
    },
    {
      id: "malatang",
      name: "麻辣烫",
      emoji: "🍲",
      hint: "要什么汤底？",
      category: "other",
      order: 30,
      options: [
        {
          id: "mild",
          label: "微辣",
          short: "微辣",
          mood: 3,
          fullness: 24,
          health: 2,
          lines: [
            "微辣的汤底，喝一口整个人都暖起来了。",
            "麻辣烫里我加了粉丝和豆皮。你猜哪一样最先被我吃掉？",
            "有一点点辣，但是很香。像是在下小雨的晚上。"
          ]
        },
        {
          id: "medium",
          label: "中辣",
          short: "中辣",
          mood: 3,
          fullness: 24,
          health: 2,
          lines: [
            "中辣……鼻尖都冒汗了。不过汤很好喝。",
            "这个辣度刚刚好，辣得我一直在偷偷吸气。",
            "麻酱和辣汤混在一起，像两种心情打架，最后和好了。"
          ]
        },
        {
          id: "hot",
          label: "特辣",
          short: "特辣",
          mood: 1,
          fullness: 24,
          health: 2,
          lines: [
            "太辣啦——！这已经不是麻辣烫，是岩浆吧。",
            "舌头麻掉了。我现在说话会不会很奇怪？",
            "特辣……你是想让我明天说不出话吗？呜。"
          ]
        },
        {
          id: "tomato",
          label: "番茄",
          short: "番茄",
          mood: 3,
          fullness: 24,
          health: 2,
          lines: [
            "番茄汤底酸酸的，很温柔。像有人把外套借给我。",
            "番茄汤里煮什么都好吃，连青菜都变得可爱了。",
            "这个汤我可以全部喝完，真的。"
          ]
        },
        {
          id: "bone",
          label: "骨汤",
          short: "骨汤",
          mood: 2,
          fullness: 25,
          health: 2.5,
          lines: [
            "骨汤很浓，喝下去胃里暖暖的。",
            "这个汤底不辣，适合慢慢吃。谢谢你记得我不能吃太辣。",
            "汤面上有一层薄薄的油光，看着就很幸福。"
          ]
        }
      ]
    },
    {
      id: "chocolate",
      name: "巧克力",
      emoji: "🍫",
      hint: "要哪一种？",
      category: "other",
      order: 50,
      options: [
        {
          id: "dark",
          label: "黑巧",
          short: "黑巧",
          mood: 3,
          fullness: 11,
          health: 1.5,
          lines: [
            "黑巧有点苦，可是苦完之后会回甘。像很多事。",
            "这个可可含量很高吧？我吃得很慢，怕浪费。",
            "苦的。不过我喜欢这种不哄人的甜。"
          ]
        },
        {
          id: "milk",
          label: "牛奶",
          short: "牛奶",
          mood: 3,
          fullness: 12,
          health: 1.5,
          lines: [
            "牛奶巧克力……太甜啦。可是我还是想吃第二块。",
            "含在嘴里慢慢化开，像一小块柔软的下午。",
            "这个甜度会让人变得有点任性。你不许告诉别人。"
          ]
        },
        {
          id: "hazelnut",
          label: "榛果",
          short: "榛果",
          mood: 3,
          fullness: 13,
          health: 1.5,
          lines: [
            "榛果碎在牙齿之间，有很轻的咔嚓声。",
            "这个味道像冬天的房间，暖气开得很足。",
            "有一颗榛果藏在最里面，被我发现了。"
          ]
        },
        {
          id: "strawberry",
          label: "草莓夹心",
          short: "草莓",
          mood: 4,
          fullness: 13,
          health: 1.5,
          lines: [
            "草莓夹心太甜啦……甜得我有点不好意思。",
            "里面的果酱流出来了，像一颗小小的、红色的秘密。",
            "巧克力壳咬开的一瞬间，心情也跟着裂开一条缝。"
          ]
        }
      ]
    },
    {
      id: "icecream",
      name: "冰淇淋",
      emoji: "🍦",
      hint: "要什么口味？",
      category: "other",
      order: 10,
      options: [
        {
          id: "vanilla",
          label: "香草",
          short: "香草",
          mood: 4,
          fullness: 10,
          health: 0.5,
          lines: [
            "香草味很干净，像一张没有写字的白纸。",
            "好凉……舌头都没知觉了。但是很甜。",
            "第一口给你。第二口也给你。我吃蛋筒就好。"
          ]
        },
        {
          id: "strawberry",
          label: "草莓",
          short: "草莓",
          mood: 4,
          fullness: 10,
          health: 0.5,
          lines: [
            "草莓味的冰淇淋是粉色的，像小时候的橡皮。",
            "化得太快了，我要吃快一点。别催我。",
            "酸酸甜甜的，吃完会想哼歌。"
          ]
        },
        {
          id: "matcha",
          label: "抹茶",
          short: "抹茶",
          mood: 3,
          fullness: 10,
          health: 0.5,
          lines: [
            "抹茶冰淇淋有一点点苦，配蛋筒刚刚好。",
            "绿色的。像把一小块春天吃掉了。",
            "这个味道很安静，适合坐在台阶上慢慢吃。"
          ]
        }
      ]
    },
    {
      id: "latiao",
      name: "辣条",
      emoji: "🌶️",
      hint: "要哪种辣度？",
      category: "other",
      order: 25,
      options: [
        { id: "sweet_sour", label: "酸甜", mood: 3, fullness: 8, health: 1, lines: ["酸甜味的辣条……有点像小时候的小卖部。", "甜和辣混在一起，奇怪地上头。"] },
        { id: "mala", label: "麻辣", mood: 3, fullness: 8, health: 1, lines: ["麻辣！舌头有点跳舞。", "好吃，但我要慢慢来。"] },
        { id: "mild", label: "微辣", mood: 2, fullness: 8, health: 1, lines: ["微辣刚好，我可以接受。", "有一点点辣，但很香。"] },
        { id: "tiny", label: "微微辣", mood: 2, fullness: 8, health: 1, lines: ["微微辣，几乎不辣。", "主要是咸香，我可以再吃一根。"] },
        { id: "hot", label: "爆辣", mood: 4, fullness: 8, health: 0, lines: ["爆辣——！水，水在哪里。", "我后悔了。但好像又有点想吃第二根。"] },
        { id: "bitter", label: "苦瓜味", mood: -1, fullness: 7, health: 0, lines: ["苦瓜味的辣条……是谁想出来的。", "又苦又辣，我表情应该很精彩。"] }
      ]
    },
    {
      id: "starry_pie",
      name: "仰望星空派",
      emoji: "🐟",
      hint: "要吃多少？",
      category: "dark",
      order: 90,
      options: [
        { id: "piece", label: "一块", mood: -2, fullness: 5, health: -8, lines: ["鱼头在看着我……我有点不敢下口。", "味道很复杂。主要是海的味道和后悔。"] },
        { id: "whole", label: "一整份", mood: -3, fullness: 8, health: -14, lines: ["一整份。……我为什么要答应。", "吃完之后，我想安静地躺一会儿。"] }
      ]
    },
    {
      id: "banlangen_noodle",
      name: "板蓝根泡面",
      emoji: "🍜",
      hint: "要吃多少？",
      category: "dark",
      order: 91,
      options: [
        { id: "small", label: "小碗", mood: -1, fullness: 6, health: -6, lines: ["板蓝根泡面……闻起来就很养生。", "味道像感冒和夜宵的混合体。"] },
        { id: "large", label: "大碗", mood: -2, fullness: 10, health: -10, lines: ["大碗。我可能是真的饿了。", "吃完这碗，我应该会好起来……吧？"] }
      ]
    },
    {
      id: "cilantro_icecream",
      name: "香菜冰淇淋",
      emoji: "🍦",
      hint: "要几个球？",
      category: "dark",
      order: 92,
      options: [
        { id: "one", label: "一球", mood: 0, fullness: 4, health: -5, lines: ["香菜冰淇淋。……它居然是绿色的。", "第一口是甜的，第二口是香菜。"] },
        { id: "two", label: "双球", mood: -1, fullness: 7, health: -9, lines: ["双球。我对自己太有信心了。", "我现在满嘴都是香菜。再见。"] }
      ]
    },
  ];

  const OUTINGS = [
    {
      id: "park",
      name: "公园",
      emoji: "🌳",
      blurb: "长椅、落叶，和一只不太理人的鸽子。",
      scene: "park",
      surprises: [
        "一只橘猫从长椅底下探出头，蹭了蹭她的裤脚。",
        "在草丛里捡到一颗很圆的橡果。",
        "有个小朋友把气球分给她一只。"
      ],
      preview: [
        "公园的长椅晒了一下午，坐上去应该还是温的。",
        "去听一会儿鸽子走路的声音吧，它们走路很认真。"
      ],
      peek: [
        "我在看两只鸽子吵架。它们吵得比我认真。",
        "风把一片叶子吹到我脚边了，像有人递来一封信。",
        "长椅另一头坐着一位老爷爷，他在喂麻雀。"
      ],
      durations: {
        10: {
          mood: 8,
          fullness: 3,
          lines: [
            "在公园的长椅上坐了十分钟。风把落叶吹到脚边，我把它夹进书里了。",
            "绕着小湖走了一圈。有只鸭子一直跟着我，可能我长得像面包。",
            "公园里有人在放风筝。我看得有点入神，差点忘记回来。"
          ],
          souvenirs: ["🍂", "🪶", "🌼"]
        },
        30: {
          mood: 20,
          fullness: 7,
          lines: [
            "绕公园走了两圈。看见一只很胖的鸽子，它看了我一眼，就走了。",
            "在树荫下坐了很久。阳光从叶子缝里漏下来，像碎掉的金币。",
            "帮一个小朋友捡了气球。他说谢谢姐姐，我开心了一路。"
          ],
          souvenirs: ["🌿", "🕊", "🧺"]
        }
      }
    },
    {
      id: "amusement",
      name: "游乐场",
      emoji: "🎡",
      blurb: "摩天轮升到最高处，可以偷偷许愿。",
      scene: "amusement",
      surprises: [
        "摩天轮的工作人员多送了她一张贴纸。",
        "买棉花糖时，老板给她多绕了一圈糖丝。",
        "在长椅上捡到一枚亮晶晶的游戏币。"
      ],
      preview: [
        "摩天轮升到最高的时候，可以偷偷许一个愿。",
        "我想坐旋转木马，挑那匹白色的。"
      ],
      peek: [
        "我在排队。前面的人买了棉花糖，闻起来很甜。",
        "摩天轮转到最高点了。你猜我刚刚许了什么愿？",
        "过山车从头顶飞过去，风把我的刘海吹乱了。"
      ],
      durations: {
        10: {
          mood: 11,
          fullness: 5,
          lines: [
            "只坐了摩天轮。升到最高的时候，我偷偷许了一个愿。",
            "买了一个棉花糖，吃到一半就化了。甜得很短暂。",
            "看别人玩过山车，听他们尖叫。我在下面笑。"
          ],
          souvenirs: ["🎡", "☁️", "🎟"]
        },
        30: {
          mood: 26,
          fullness: 10,
          lines: [
            "玩了旋转木马和碰碰车。人群很吵，但我没有觉得孤单。",
            "排了很久的队，只为一个两分钟的项目。奇怪，居然不后悔。",
            "黄昏的摩天轮会发光。我在最高处想，如果你在就好了。"
          ],
          souvenirs: ["🎠", "🎪", "🌆"]
        }
      }
    },
    {
      id: "riverside",
      name: "江边",
      emoji: "🌊",
      blurb: "数船，吹风，把心事交给水面。",
      scene: "river",
      surprises: [
        "江风把一张旧明信片吹到她脚边，上面写着“下次见”。",
        "一只白鹭在她面前站了很久，像在陪她发呆。",
        "卖糖葫芦的爷爷多给了她一颗山楂。"
      ],
      preview: [
        "江边的风应该很大，我可能会把头发扎起来。",
        "去数一数今天有几艘船经过。"
      ],
      peek: [
        "江面很亮。我在数船，已经数到第五艘了。",
        "风把头发吹到嘴里了……呸。",
        "有个人在钓鱼，桶里只有一只小虾。他看起来还是很开心。"
      ],
      durations: {
        10: {
          mood: 9,
          fullness: 3,
          lines: [
            "江面很亮。我数了七艘船，每一艘都开往我不知道的地方。",
            "风把头发吹乱了。我懒得整理，反正也没人看。",
            "在堤岸上坐了一会儿。水声很吵，心里反而安静了。"
          ],
          souvenirs: ["🌊", "⛵", "🐚"]
        },
        30: {
          mood: 22,
          fullness: 7,
          lines: [
            "沿着江边走很久。风把头发吹乱，我懒得整理。",
            "看见有人在钓鱼，桶里只有一只小虾。他还是很开心。",
            "太阳落下去的时候，江面像被谁撒了一把碎金。我看了很久。"
          ],
          souvenirs: ["🪁", "🌇", "🪨"]
        }
      }
    },
    {
      id: "bookstore",
      name: "旧书店",
      emoji: "📚",
      blurb: "旧纸的味道，和一本 1998 年的诗集。",
      scene: "bookstore",
      surprises: [
        "旧书里夹着一张 1998 年的书签，背面画着一只小猫。",
        "书店的猫在她腿上睡着了，她没舍得动。",
        "老板送了她一杯热茶，杯底压着一句手写诗。"
      ],
      preview: [
        "旧书店的纸味很好闻，像下过雨的木头。",
        "去翻一本没有结尾的诗集。"
      ],
      peek: [
        "我在书店角落。老板没有赶我，还给我倒了热水。",
        "刚翻到一首很短的诗，短得像一声叹气。",
        "书店的猫趴在我旁边。我翻页的时候，它耳朵动了一下。"
      ],
      durations: {
        10: {
          mood: 10,
          fullness: 3,
          lines: [
            "在旧书店翻到一本 1998 年的诗集，扉页有人写过一句话。",
            "找到了小时候看过的绘本。纸都黄了，故事还亮着。",
            "书店的猫趴在收银台上，我摸了它三下。它没有走。"
          ],
          souvenirs: ["📖", "🔖", "🐈"]
        },
        30: {
          mood: 24,
          fullness: 7,
          lines: [
            "在书店角落坐了一下午。老板没有赶我，还给我倒了热水。",
            "买了一本旧书，里面夹着一张旧车票。不知道它去过哪里。",
            "读完了一个短篇。结尾没有写完，我替它想了三种结局。"
          ],
          souvenirs: ["📚", "☕", "🎫"]
        }
      }
    }
  ];

  const OUTING_DURATIONS = [10, 30];

  const EXERCISES = [
    {
      id: "run",
      name: "跑步",
      emoji: "🏃",
      blurb: "沿着江边跑一小段，风从耳边过去。",
      scene: "run",
      preview: [
        "跑起来的时候，脑子里的声音会小一点。",
        "我会沿着江边跑，不会跑太远。"
      ],
      peek: [
        "正在跑步……汗水要滴到眼睛里了。",
        "呼、呼……你先别说话，我在数呼吸。",
        "风好大。再跑一会儿就回去。"
      ],
      durations: {
        3: {
          health: 3,
          fatigue: 10,
          mood: 1,
          lines: ["跑了三分钟，腿有点酸。但是风很舒服。", "三分钟刚刚好，再久一点我就要喘了。"]
        },
        5: {
          health: 5,
          fatigue: 17,
          mood: 2,
          lines: ["五公里是不可能的，五公里的一半也不可能。五分钟后我回来了。", "跑完五分钟后，我坐在台阶上看了会儿云。"]
        },
        10: {
          health: 9,
          fatigue: 27,
          mood: 2,
          lines: ["十分钟。出了一身汗，心情却轻了一点。", "跑到最后一段的时候，有一只狗超过了我。它跑得真快。"]
        },
        30: {
          health: 20,
          fatigue: 54,
          mood: 4,
          lines: ["半个小时……我居然坚持下来了。膝盖在抗议，但我不后悔。", "跑完三十分钟，我觉得自己可以变成一阵风。"]
        }
      }
    },
    {
      id: "rope",
      name: "跳绳",
      emoji: "🤸",
      blurb: "绳子打在地上，啪、啪、啪。",
      scene: "rope",
      preview: [
        "跳绳的时候，世界会变得很有节奏。",
        "我只会最普通的那种跳法，不会交叉。"
      ],
      peek: [
        "正在跳绳……啪、啪、啪。数到一百之前别叫我。",
        "绳子抽到小腿了。有点疼，但我还跳得动。",
        "呼吸乱了。等我跳完这一组。"
      ],
      durations: {
        3: {
          health: 3,
          fatigue: 12,
          mood: 1,
          lines: ["跳了三分钟，绳子差点缠到脚。", "一百二十下。我数的，大概是。"]
        },
        5: {
          health: 5,
          fatigue: 19,
          mood: 2,
          lines: ["五分钟跳绳，比我以为的累。", "出了一点汗，头发贴在额头上。"]
        },
        10: {
          health: 10,
          fatigue: 30,
          mood: 2,
          lines: ["十分钟。后来我跳得越来越慢，但没停。", "绳子打在地上，像在给心跳打拍子。"]
        },
        30: {
          health: 22,
          fatigue: 60,
          mood: 4,
          lines: ["三十分钟跳绳……腿已经不属于我了。", "我坚持完了。现在只想躺着，谁也别碰我。"]
        }
      }
    },
    {
      id: "walk",
      name: "散步",
      emoji: "🚶",
      blurb: "不赶路，只是走走。",
      scene: "walk",
      preview: [
        "散步不算运动吧？……算的，走快一点就算。",
        "我想沿着街边走，看看别人家的窗台。"
      ],
      peek: [
        "正在散步。没有急事，所以走得很慢。",
        "路边的桂花开了。你闻不到，我替你闻了。",
        "我在数第几个路口有便利店。"
      ],
      durations: {
        3: {
          health: 2,
          fatigue: 5,
          mood: 1,
          lines: ["走了三分钟，路边有一只猫在晒太阳。", "短途散步，像给脑子按了暂停。"]
        },
        5: {
          health: 3,
          fatigue: 9,
          mood: 2,
          lines: ["五分钟后，我买了一杯温水。", "不赶路的时候，街道会变得很长。"]
        },
        10: {
          health: 6,
          fatigue: 16,
          mood: 3,
          lines: ["走了十分钟，看见一棵很大的树。", "脚步慢下来，心事也慢下来。"]
        },
        30: {
          health: 14,
          fatigue: 32,
          mood: 5,
          lines: ["走了半小时，绕了很大的一个圈。", "走到最后，我有点忘记自己要去哪里。不过没关系。"]
        }
      }
    },
    {
      id: "stretch",
      name: "拉伸",
      emoji: "🧘",
      blurb: "把肩膀放下来，呼吸慢一点。",
      scene: "stretch",
      preview: [
        "拉伸的时候可以顺便发一会儿呆。",
        "肩颈有点僵。慢慢来吧。"
      ],
      peek: [
        "正在拉伸……这个动作有点酸，不过很舒服。",
        "呼吸，慢一点。再慢一点。",
        "别催，我在和自己的身体商量。"
      ],
      durations: {
        3: {
          health: 2,
          fatigue: 4,
          mood: 2,
          lines: ["拉伸了三分钟，肩膀松了一点。", "三个深呼吸。感觉把皱起来的地方摊平了。"]
        },
        5: {
          health: 4,
          fatigue: 7,
          mood: 2,
          lines: ["五分钟拉伸，骨头在轻轻响。", "最后一组动作，我差点睡着了。"]
        },
        10: {
          health: 7,
          fatigue: 12,
          mood: 3,
          lines: ["十分钟。今天对自己的身体温柔了一点。", "拉伸完喝了一口水。水是温的。"]
        },
        30: {
          health: 16,
          fatigue: 24,
          mood: 4,
          lines: ["三十分钟拉伸，像把自己重新叠整齐了一次。", "最后躺着的时候，差点不想起来。"]
        }
      }
    }
  ];

  const EXERCISE_DURATIONS = [3, 5, 10, 30];
  const EXERCISE_TIRED_LINES = [
    "今天已经很累了，再运动的话膝盖会哭的。",
    "腿还在发抖……让我休息一会儿好不好？",
    "我真的动不了了。明天再一起运动吧。"
  ];
  const EXERCISE_STATUS_LINES = {
    run: [
      "正在跑步……汗水要滴到眼睛里了。",
      "呼、呼……先别打扰我，我在数呼吸。",
      "风好大。再跑一会儿就好。"
    ],
    rope: [
      "正在跳绳……啪、啪、啪。",
      "绳子抽到小腿了，不过我还跳得动。",
      "数到一百之前，先别叫我。"
    ],
    walk: [
      "正在散步，没有急事，所以走得很慢。",
      "路边的桂花开了。我替你闻过了。",
      "还有一点点路。回去给你带一片叶子。"
    ],
    stretch: [
      "正在拉伸……这个动作有点酸，不过很舒服。",
      "呼吸，慢一点。再慢一点。",
      "别催，我在和自己的身体商量。"
    ]
  };

  const SCENES = [
    {
      id: "home",
      name: "家",
      emoji: "🏠",
      subtitle: "暖黄的灯，一张旧毯子，和她的书。",
      wall: ["#FBF1E7", "#F1DFD0"],
      floor: "#DCC4AE",
      accent: "#C98F75"
    },
    {
      id: "window",
      name: "窗边",
      emoji: "🪟",
      subtitle: "下午的光落在书页上，灰尘慢慢飘。",
      wall: ["#F7F2E8", "#E9E3D2"],
      floor: "#CFC2AA",
      accent: "#8FA78F"
    },
    {
      id: "rain",
      name: "雨夜",
      emoji: "🌧",
      subtitle: "雨点敲着窗，屋里只亮着一盏小灯。",
      wall: ["#E8E6E8", "#D4D5DD"],
      floor: "#AEB0BE",
      accent: "#7E87A3"
    },
    {
      id: "garden",
      name: "小花园",
      emoji: "🌿",
      subtitle: "有一点风，和很多绿色。",
      wall: ["#EDF3E6", "#DDE8D2"],
      floor: "#B9C9A4",
      accent: "#7F9179"
    }
  ];

  const PROFILE_TIPS = [
    "右键我，可以打开个人页面。",
    "一直戳我，我会晕的。……但还是会回应你。",
    "在手机上登录同一个账号，这样我就能同时陪着你。",
    "喂我吃东西之前，先看看我饱不饱。饱食度也会悄悄加一点健康。",
    "出去玩或者运动的时候，我会自己看时间。",
    "不用一直陪我说话，待在这里就好。"
  ];

  return {
    VERSION,
    DEFAULT_NAME,
    MOOD_LABELS,
    TAP_LINES,
    SLEEP_MURMURS,
    FRIEND_LINES,
    HUNGER_LINES,
    SPAM_MARKS,
    FEED,
    FEED_CATEGORIES,
    OUTINGS,
    OUTING_DURATIONS,
    EXERCISES,
    EXERCISE_DURATIONS,
    EXERCISE_TIRED_LINES,
    EXERCISE_STATUS_LINES,
    SCENES,
    PROFILE_TIPS
  };
});
