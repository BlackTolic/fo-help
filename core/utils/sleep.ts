/** 异步等待毫秒数(动作之间留渲染/动画时间,别用忙等) */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
