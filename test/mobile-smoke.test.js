import test from 'node:test';
import assert from 'node:assert/strict';
import { isLobby } from '../mobile/ci/smoke-dom.mjs';

test('lobby gate accepts the v0.3.3 hub without a protocol heading or visible nickname', () => {
  // 来自 40144373716 的实际可见 DOM；布局不再常驻协议弹窗标题和昵称。
  const state = { route: 'lobby', playerName: 'AndroidQA',
    text: '返回\n3\nms\n第二期下半\nSTRONGHOLD PROTOCOL ALLIANCE\n卫戍协议：盟约\nS.W.E.E.P.报告\n干员调配\n成就统计\n1 名博士\nSOLO SIMULATION\n独立模拟\n1–4 名博士\nALLIANCE SIMULATION\n同盟模拟' };
  assert.equal(isLobby(state), true);
  assert.equal(isLobby({ ...state, text: 'AndroidQA 选择模拟协议 独立模拟 同盟模拟' }), true);
  for (const change of [{ route: 'title' }, { route: 'room' }, { playerName: '' }, { playerName: 'SomeoneElse' },
    { text: 'STRONGHOLD PROTOCOL 博士代号 开始 已连接服务器' }, { text: '独立模拟' }, { text: '同盟模拟' }]) {
    assert.equal(isLobby({ ...state, ...change }), false, JSON.stringify(change));
  }
});
