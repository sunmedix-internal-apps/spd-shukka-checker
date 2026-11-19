"use strict";
{

// キーはラベルマスタ.tsvの「商品コード」。基準JANは登録せず、追加JANだけを記載する。
// 製品番号・商品名・規格は管理用の補足であり、照合判定には使用しない。
const ALTERNATE_JAN_BY_PRODUCT_CODE = {
  "192732": {
    productNo: "GJ-S0215",
    name: "ゴージョーＭＨＳゲル状手指殺菌消毒剤",
    spec: "２１５ｍｌ　ポンプボトル",
    alternateJans: [
      "4987350365286"
    ]
  },
  "102396": {
    productNo: "GJ-S0350",
    name: "ゴージョー手指消毒液　ポンプボトル",
    spec: "３５０ｍｌ",
    alternateJans: [
      "4987350365309"
    ]
  },
  "46887": {
    productNo: "80827",
    name: "ダルムスペースリッチⅢ",
    spec: "大腸検査食",
    alternateJans: [
      "498704080277"
    ]
  },
  "499809": {
    productNo: "7115",
    name: "Ｔ．Ｅ．Ｄ．サージカル　ストッキング",
    spec: "ハイソックス　２４ｈＰａ　レギュラー　Ｍ",
    alternateJans: [
      "0192253015973"
    ]
  },
  "499772": {
    productNo: "3728LF",
    name: "Ｔ．Ｅ．Ｄ．サージカル　ストッキング",
    spec: "２４ｈＰａ　レギュラー　Ｌ",
    alternateJans: [
      "0192253015522"
    ]
  },
  "499769": {
    productNo: "3416LF",
    name: "Ｔ．Ｅ．Ｄ．サージカル　ストッキング",
    spec: "２４ｈＰａ　レギュラー　Ｍ",
    alternateJans: [
      "0192253015478"
    ]
  },
  "499766": {
    productNo: "3130LF",
    name: "Ｔ．Ｅ．Ｄ．サージカル　ストッキング",
    spec: "２４ｈＰａ　レギュラー　Ｓ",
    alternateJans: [
      "0192253015331"
    ]
  },
  "145104": {
    productNo: "SCM-400PRP",
    name: "サニーコップ",
    spec: "検査用コップ　４００ｃｃ　５０入/袋",
    alternateJans: [
      "4974625517884"
    ]
    },
  "344530": {
    productNo: "KX-J014",
    name: "テクノクリアＮ　リンス剤",
    spec: "ベッド／カ－トウォッシャ－専用すすぎ剤（５Ｌ／中性）",
    alternateJans: [
      "2000000000015"
    ]
  },
 "86878": {
    productNo: "R1547",
    name: "ステリストリップスタンダード　R-1547",
    spec: "幅１２×全長１００ｍｍ　ブルー　白色タイプ　６入",
    alternateJans: [
      "0707387804688"
    ]
  },
 "86874": {
    productNo: "R1540",
    name: "ステリストリップスタンダード　スキンクロージャー",
    spec: "幅３×全長７５ｍｍ　パープル　白色タイプ",
    alternateJans: [
      "0707387804626"
    ]
  },
 "86875": {
    productNo: "R1541",
    name: "ステリストリップスタンダード　スキンクロージャー",
    spec: "幅６×全長７５ｍｍ　Ｒ1541　3本/袋",
    alternateJans: [
      "0707387804633"
    ]
  },  
 "120276": {
    productNo: "1101051",
    name: "ヨードホルムガーゼ",
    spec: "３０ｃｍ×８ｍ",
    alternateJans: [
      "4958286110134"
    ]
  },
 "164752": {
    productNo: "0-7393-02",
    name: "入院患者識別バンド",
    spec: "ＳＦ－９０ＳＴピンク",
    alternateJans: [
      "2000000000022"
    ]
  }, 
 "164754": {
    productNo: "0-7393-04",
    name: "入院患者識別バンド",
    spec: "ＳＦ－９０ＳＴホワイト",
    alternateJans: [
      "2000000000039"
    ]
  },
 "176283": {
    productNo: "6-296-45",
    name: "試験管",
    spec: "採血－Ｍ　直口　１００本入",
    alternateJans: [
      "2000000000046"
    ]
  },
 "145103": {
    productNo: "MC-250",
    name: "メディカルコップ（紙製）ＳＭＴ－２７５Ｐ",
    spec: "２７５ｃｃ　１００入",
    alternateJans: [
      "2000000000053"
    ]
  },
 "344186": {
    productNo: "8-8368-02",
    name: "廃液吸引バック",
    spec: "廃液凝固剤（約３０回分）　６００ｇ入",
    alternateJans: [
      "2000000000060"
    ]
  },
 "344185": {
    productNo: "8-8368-01",
    name: "廃液吸引バック",
    spec: "３０枚入",
    alternateJans: [
      "2000000000077"
    ]
  },
 "464218": {
    productNo: "3687V428",
    name: "超音波ゼリー",
    spec: "ＳＧ－４ｋｇ　２ｋｇ",
    alternateJans: [
      "1457114284579"
    ]
  },
 "467178": {
    productNo: "53515",
    name: "プラスチック手袋　Ｅ",
    spec: "Ｍ　パウダーなし　１００入",
    alternateJans: [
      "1498769653515"
    ]
  },
 "467177": {
    productNo: "53514",
    name: "プラスチック手袋　Ｅ",
    spec: "Ｓ　パウダーなし　１００入",
    alternateJans: [
      "1498769653514"
    ]
  },
 "549812": {
    productNo: "417014244",
    name: "Ｆ　ＪＥＬＬＹ　ＰＬＵＳ",
    spec: "ミドル　詰替用　空ボトル２本付　２ｋｇ",
    alternateJans: [
      "4547410357912"
    ]
  },
  "69624": {
    productNo: "60615",
    name: "バードポート－Ｔｉ",
    spec: "８．０Ｆｒ　Ｉ／Ｄ　１．５ｍｍ",
    alternateJans: [
      "0801741098253"
    ]
  }, 
  "147587": {
    productNo: "55417",
    name: "セーフティセット　顔あて",
    spec: "６００７",
    alternateJans: [
      "4580193600066"
    ]
  } 
};

// ブラウザ・Service Worker・自動テストで同じ表を使用する。
globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE = ALTERNATE_JAN_BY_PRODUCT_CODE;
if (typeof module !== "undefined" && module.exports) module.exports = ALTERNATE_JAN_BY_PRODUCT_CODE;
}
