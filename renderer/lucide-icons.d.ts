// lucide-react 的 dist/esm/icons/* 只有 .js,包里没有逐个图标的 .d.ts
// (唯一的类型文件是 1.9MB 的 dist/lucide-react.d.ts,为了 renderer/icons.ts 里
// 三十来个图标去解析它不划算)。这里按 lucide-react 自己的 LucideIcon 定义,
// 给深路径补一个模块声明。

declare module 'lucide-react/dist/esm/icons/*' {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';

  const Icon: ForwardRefExoticComponent<
    Omit<SVGProps<SVGSVGElement>, 'ref'> & {
      size?: string | number;
      absoluteStrokeWidth?: boolean;
    } & RefAttributes<SVGSVGElement>
  >;
  export default Icon;
}
