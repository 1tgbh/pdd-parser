"""
商品数据解析器 - 从拼多多 API 响应中提取完整商品信息
"""

import re
from datetime import datetime
from models import GoodsInfo, SkuItem, SkuSpec


class GoodsParser:
    """商品数据解析器"""
    
    @staticmethod
    def parse(response_data: dict) -> GoodsInfo:
        """解析商品详情响应"""
        goods_data = GoodsParser._extract_goods_data(response_data)
        if not goods_data:
            return None
        
        goods = GoodsInfo()
        goods.crawl_time = datetime.now().isoformat()
        goods.raw_data = goods_data
        
        # 基本信息
        goods.goods_id = str(goods_data.get("goods_id", goods_data.get("goodsID", "")))
        goods.title = goods_data.get("goods_name", goods_data.get("goodsName", ""))
        goods.subtitle = goods_data.get("goods_desc", goods_data.get("desc", ""))
        
        # 卖点
        goods.selling_points = GoodsParser._extract_selling_points(goods_data)
        
        # 价格
        goods.price = GoodsParser._to_float(goods_data.get("min_group_price", goods_data.get("price", 0)))
        goods.original_price = GoodsParser._to_float(goods_data.get("market_price", goods_data.get("normal_price", 0)))
        goods.min_group_price = GoodsParser._to_float(goods_data.get("min_group_price", goods_data.get("group_price", 0)))
        
        # 销售数据
        goods.sales = int(goods_data.get("sales", 0) or 0)
        goods.sold_quantity = int(goods_data.get("sold_quantity", 0) or 0)
        
        # 店铺
        goods.shop_name = goods_data.get("mall_name", goods_data.get("shop_name", ""))
        goods.shop_id = str(goods_data.get("mall_id", goods_data.get("shop_id", "")))
        goods.shop_logo = goods_data.get("mall_logo", goods_data.get("shop_logo", ""))
        
        # 图片
        goods.main_images = GoodsParser._extract_images(goods_data, ["top_gallery", "topGallery", "gallery", "images"])
        goods.detail_images = GoodsParser._extract_images(goods_data, ["detail_gallery", "desc_gallery", "goods_desc_images"])
        goods.sku_images = GoodsParser._extract_sku_images(goods_data)
        
        # 规格和 SKU
        goods.specs, goods.skus = GoodsParser._parse_skus(goods_data)
        
        # 商品描述
        goods.description = GoodsParser._extract_description(goods_data)
        
        # 商品属性
        goods.attributes = GoodsParser._extract_attributes(goods_data)
        
        return goods
    
    @staticmethod
    def _extract_goods_data(data: dict) -> dict | None:
        """从响应中提取商品数据"""
        if not data or not isinstance(data, dict):
            return None
        if "goods_detail_response" in data:
            resp = data["goods_detail_response"]
            goods = resp.get("goods", resp.get("goods_list", []))
            if isinstance(goods, list) and goods:
                return goods[0]
            elif isinstance(goods, dict):
                return goods
        
        if "goods_detail" in data:
            return data["goods_detail"]
        
        if "goods_id" in data or "goodsID" in data:
            return data
        
        return None
    
    @staticmethod
    def _extract_selling_points(data: dict) -> list:
        """提取卖点"""
        points = []
        
        # 从服务标签提取
        for key in ["service_tags", "goods_service_tags", "tags"]:
            tags = data.get(key, [])
            if isinstance(tags, list):
                for tag in tags:
                    if isinstance(tag, dict):
                        text = tag.get("text", tag.get("name", tag.get("desc", "")))
                        if text:
                            points.append(text)
                    elif isinstance(tag, str):
                        points.append(tag)
        
        # 从促销信息提取
        promotions = data.get("promotions", data.get("promotion", []))
        if isinstance(promotions, list):
            for p in promotions:
                if isinstance(p, dict):
                    text = p.get("text", p.get("desc", ""))
                    if text:
                        points.append(text)
                elif isinstance(p, str):
                    points.append(p)
        
        # 从侧边信息提取
        side = data.get("side_ext", {})
        if isinstance(side, dict):
            for key in ["tag_list", "tags"]:
                tags = side.get(key, [])
                if isinstance(tags, list):
                    for t in tags:
                        if isinstance(t, dict) and t.get("text"):
                            points.append(t["text"])
        
        return list(set(points))  # 去重
    
    @staticmethod
    def _extract_images(data: dict, keys: list) -> list:
        """提取图片列表"""
        images = []
        for key in keys:
            value = data.get(key, [])
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and item.startswith("http"):
                        images.append(item)
                    elif isinstance(item, dict):
                        url = item.get("url", item.get("image_url", item.get("src", "")))
                        if url and url.startswith("http"):
                            images.append(url)
            elif isinstance(value, str) and value.startswith("http"):
                images.append(value)
        return images
    
    @staticmethod
    def _extract_sku_images(data: dict) -> list:
        """提取 SKU 图片"""
        images = []
        sku_list = data.get("sku", data.get("skus", []))
        if isinstance(sku_list, list):
            for s in sku_list:
                if isinstance(s, dict):
                    img = s.get("thumb_url", s.get("image", s.get("sku_image", "")))
                    if img and img.startswith("http") and img not in images:
                        images.append(img)
        return images
    
    @staticmethod
    def _parse_skus(data: dict) -> tuple:
        """解析 SKU，返回 (specs_dict, sku_list)"""
        specs = {}
        skus = []
        
        sku_list = data.get("sku", data.get("skus", []))
        if not isinstance(sku_list, list):
            return specs, skus
        
        for s in sku_list:
            if not isinstance(s, dict):
                continue
            
            sku = SkuItem(
                sku_id=str(s.get("sku_id", s.get("skuId", ""))),
                price=GoodsParser._to_float(s.get("group_price", s.get("price", 0))),
                original_price=GoodsParser._to_float(s.get("normal_price", s.get("original_price", 0))),
                stock=int(s.get("quantity", s.get("stock", 0)) or 0),
                image=s.get("thumb_url", s.get("image", "")),
            )
            
            # 解析规格
            for sp in s.get("specs", s.get("spec", [])):
                if not isinstance(sp, dict):
                    continue
                name = sp.get("spec_key", sp.get("spec", ""))
                value = sp.get("spec_value", sp.get("value", ""))
                if name and value:
                    sku.specs.append(SkuSpec(name=name, value=value))
                    if name not in specs:
                        specs[name] = []
                    if value not in specs[name]:
                        specs[name].append(value)
            
            skus.append(sku)
        
        return specs, skus
    
    @staticmethod
    def _extract_description(data: dict) -> str:
        """提取商品描述文案"""
        for key in ["goods_desc", "desc", "description", "detail_desc"]:
            desc = data.get(key, "")
            if isinstance(desc, str) and len(desc) > 10:
                return desc
        
        # 从详情图片的 alt 文本提取
        desc_parts = []
        for key in ["detail_gallery", "desc_gallery"]:
            imgs = data.get(key, [])
            if isinstance(imgs, list):
                for img in imgs:
                    if isinstance(img, dict):
                        alt = img.get("alt", img.get("desc", ""))
                        if alt:
                            desc_parts.append(alt)
        
        return "\n".join(desc_parts)
    
    @staticmethod
    def _extract_attributes(data: dict) -> dict:
        """提取商品属性"""
        attrs = {}
        
        # 从属性列表提取
        for key in ["goods_props", "attributes", "properties", "spec_list"]:
            props = data.get(key, [])
            if isinstance(props, list):
                for p in props:
                    if isinstance(p, dict):
                        name = p.get("key", p.get("name", ""))
                        value = p.get("value", p.get("val", ""))
                        if name and value:
                            attrs[name] = value
        
        # 从基本信息提取
        basic_attrs = {
            "品牌": data.get("brand_name", data.get("brand", "")),
            "产地": data.get("origin", data.get("place_of_origin", "")),
            "材质": data.get("material", ""),
            "重量": data.get("weight", ""),
        }
        for k, v in basic_attrs.items():
            if v and k not in attrs:
                attrs[k] = str(v)
        
        return attrs
    
    @staticmethod
    def _to_float(value) -> float:
        """安全转换为浮点数"""
        try:
            if isinstance(value, str):
                value = value.replace("¥", "").replace(",", "").strip()
            return float(value)
        except (ValueError, TypeError):
            return 0.0
