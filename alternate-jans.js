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
  "367392": {
    productNo: "WB7024FW",
    name: "管路洗浄ブラシ",
    spec: "ＦＵＪＩＦＩＬＭ",
    alternateJans: [
      "4547410297409"
    ]
  }
};

// ブラウザ・Service Worker・自動テストで同じ表を使用する。
globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE = ALTERNATE_JAN_BY_PRODUCT_CODE;
if (typeof module !== "undefined" && module.exports) module.exports = ALTERNATE_JAN_BY_PRODUCT_CODE;
}
