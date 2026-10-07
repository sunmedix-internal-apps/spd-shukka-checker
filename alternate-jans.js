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
  "381714": {
    productNo: "test",
    name: "エラスコット4号",
    spec: "特注",
    alternateJans: [
      "4901301251039"
    ]
  }
};

// ブラウザ・Service Worker・自動テストで同じ表を使用する。
globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE = ALTERNATE_JAN_BY_PRODUCT_CODE;
if (typeof module !== "undefined" && module.exports) module.exports = ALTERNATE_JAN_BY_PRODUCT_CODE;
}
