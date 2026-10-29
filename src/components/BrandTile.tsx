import { CatMark } from './Cat';

/**
 * 商品图标：用品牌名显示。字多自动缩小，没有品牌就退到名称首字，再没有就显示猫。
 */
export function BrandTile({
  label,
  brand,
  name,
  size = 'md',
}: {
  label?: string;
  brand?: string;
  name?: string;
  size?: 'md' | 'lg';
}) {
  const source = (label || brand || name || '').trim();
  const text = source.slice(0, 4);
  const fontSize = text.length <= 2 ? 15 : text.length === 3 ? 12 : 10;
  const className = `thumb brand-tile ${size === 'lg' ? 'thumb-lg' : ''}`;

  if (!text) {
    return (
      <span className={`${className} brand-tile-empty`}>
        <CatMark size={size === 'lg' ? 30 : 20} />
      </span>
    );
  }
  return (
    <span className={className} style={{ fontSize }}>
      {text}
    </span>
  );
}
