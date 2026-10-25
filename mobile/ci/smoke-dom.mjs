// 大厅布局会调整；登录身份从游戏状态核对，不要求昵称或弹窗标题常驻页面。
export function isLobby(state) {
  return state.route === 'lobby' && state.playerName === 'AndroidQA'
    && state.text.includes('独立模拟') && state.text.includes('同盟模拟');
}
