/* Application adapter; all writes require an explicit action button. */
(function () {
  'use strict';
  function init() {
    JevUI.mount({
      title: 'Describe your two alerts',
      description:
        'Enter exactly two prices. Jev interprets any stated directions. Review the preview, then fill the existing price fields; Save & arm is still required.',
      fields: [
        {
          key: 'instruction',
          label: 'Alert instruction',
          max: 600,
          placeholder: 'Alert above $4,200 and below $4,000',
        },
      ],
      endpoint: '/api/jev',
      cookieAuth: true,
      runLabel: 'Preview alerts',
      input(v) {
        return {
          instruction: v.instruction,
          reference: Number(document.getElementById('price').textContent.replace(/[^0-9.]/g, '')),
        };
      },
      actionLabel: 'Fill both target fields',
      actionNote: 'Alerts are not armed. Review both fields and click Save & arm.',
      action(row, input, _fields, rows) {
        const values = JevFeature.prices(input.instruction).map(Number);
        if (values.includes(input.reference)) throw new Error('Choose targets strictly above or below current price.');
      if (values.length !== 2 || !input.reference)
          throw new Error('A current displayed price is needed.');
        if (
          rows.length !== 2 ||
          rows.some((x) => !['up', 'down'].includes(x.direction) || x.confidence < 0.8)
        )
          throw new Error('Specify an unambiguous direction for each target and run Jev again.');
        for (let i = 0; i < 2; i++) {
          const direction = values[i] >= input.reference ? 'up' : 'down';
          if (rows[i].direction !== direction)
            throw new Error(
              'Requested direction conflicts with the existing alert rule at this price. Use targets on the requested side of current price.',
            );
        }
        for (let i = 0; i < 2; i++) {
          const node = document.getElementById('p' + (i + 1));
          node.value = values[i];
          node.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
    });
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
