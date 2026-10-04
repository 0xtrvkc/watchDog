/* Bounded decisions for this application. */
(function (root, factory) {
  const api = factory(
    root.JevContract || (typeof require === 'function' ? require('./contract.js') : null),
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JevFeature = api;
})(globalThis, function (C) {
  'use strict';

  function prices(text) {
    const values = [...text.matchAll(/(?:\$\s*)?[-+]?\d[\d,]*(?:\.\d+)?/g)].map((x) =>
      x[0].replace(/[$\s]/g, ''),
    );
    if (
      values.some(
        (x) =>
          !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(x) ||
          Number(x.replace(/,/g, '')) <= 0 ||
          Number(x.replace(/,/g, '')) > 1000000,
      )
    )
      throw new Error('Use positive USD prices with at most two decimal places.');
    return [...new Set(values.map((x) => x.replace(/,/g, '')))];
  }
  const F = {
    id: 'alert-parser',
    private: true,
    prices,
    build(input) {
      const instruction = C.text(input.instruction, 'Alert instruction', 600),
        found = prices(instruction);
      if (found.length !== 2)
        throw new Error('Include exactly two distinct target prices and no other numbers.');
      const questions = {};
      for (let i = 0; i < 2; i++)
        questions['direction' + i] = C.choice(
          'What direction does `instruction` explicitly request for target ' +
            found[i] +
            ' USD per troy ounce? Do not infer a missing direction.',
          {
            up: 'Reach or cross at or above this price',
            down: 'Reach or cross at or below this price',
            unspecified: 'Direction is absent or ambiguous',
          },
        );
      return { state: { instruction, prices: found }, questions };
    },
    present(input, answers) {
      return prices(input.instruction).map((price, i) => ({
        title: 'Target ' + (i + 1) + ' · $' + price,
        label:
          C.decision(answers['direction' + i]) === 'review'
            ? 'Needs review'
            : answers['direction' + i].choice,
        detail: 'Preview only. Your existing Save & arm button is required.',
        confidence: answers['direction' + i].confidence,
        action: 'fill',
        price: Number(price),
        direction: C.decision(answers['direction' + i]),
      }));
    },
  };

  return Object.freeze(F);
});
