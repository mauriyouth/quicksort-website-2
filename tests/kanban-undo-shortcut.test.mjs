import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kanbanHistoryShortcut } from '../packages/candidate-ui/src/kanbanUndo.ts';
const key = { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false, defaultPrevented: false, target: null };
test('Undo accepts both platforms and accepts redo and preserves native editing', () => {
  assert.equal(kanbanHistoryShortcut(key), "undo");
  assert.equal(kanbanHistoryShortcut({ ...key, key: 'Z', ctrlKey: false, metaKey: true }), "undo");
  assert.equal(kanbanHistoryShortcut({...key, shiftKey:true}), "redo");
  assert.equal(kanbanHistoryShortcut({...key, ctrlKey:false, metaKey:true, shiftKey:true}), "redo");
  for (const patch of [{ctrlKey:false}, {altKey:true}, {repeat:true}, {defaultPrevented:true}, {key:'y'}, {target:{isContentEditable:true}}, {target:{closest:()=>({})}}]) {
    assert.equal(kanbanHistoryShortcut({...key, ...patch}), null);
  }
});
