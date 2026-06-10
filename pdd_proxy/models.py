"""
商品数据模型 - 定义完整的商品信息结构
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime


@dataclass
class SkuSpec:
    """SKU 规格"""
    name: str = ""      # 规格名，如"颜色"
    value: str = ""     # 规格值，如"白色"


@dataclass
class SkuItem:
    """SKU 单品"""
    sku_id: str = ""
    specs: List[SkuSpec] = field(default_factory=list)
    price: float = 0.0
    original_price: float = 0.0
    stock: int = 0
    image: str = ""


@dataclass
class GoodsInfo:
    """完整商品信息"""
    # 基本信息
    goods_id: str = ""
    title: str = ""                    # 商品标题
    subtitle: str = ""                 # 副标题
    selling_points: List[str] = field(default_factory=list)  # 卖点
    
    # 价格信息
    price: float = 0.0                 # 当前价
    original_price: float = 0.0        # 原价
    min_group_price: float = 0.0       # 拼团价
    
    # 销售数据
    sales: int = 0                     # 销量
    sold_quantity: int = 0             # 已拼件数
    
    # 店铺信息
    shop_name: str = ""
    shop_id: str = ""
    shop_logo: str = ""
    
    # 图片
    main_images: List[str] = field(default_factory=list)    # 主图
    detail_images: List[str] = field(default_factory=list)  # 详情图
    sku_images: List[str] = field(default_factory=list)     # SKU 图
    
    # 规格参数
    specs: Dict[str, List[str]] = field(default_factory=dict)  # {"颜色": ["白", "黑"], "尺码": ["37","38"]}
    skus: List[SkuItem] = field(default_factory=list)
    
    # 商品描述
    description: str = ""              # 商品详情文案
    attributes: Dict[str, str] = field(default_factory=dict)  # 商品属性 {"材质": "棉", "产地": "中国"}
    
    # 元数据
    source_url: str = ""
    crawl_time: str = ""
    raw_data: Optional[dict] = None
    
    def to_dict(self) -> dict:
        """转为字典，用于导出"""
        return {
            "goods_id": self.goods_id,
            "title": self.title,
            "subtitle": self.subtitle,
            "selling_points": self.selling_points,
            "price": self.price,
            "original_price": self.original_price,
            "min_group_price": self.min_group_price,
            "sales": self.sales,
            "sold_quantity": self.sold_quantity,
            "shop_name": self.shop_name,
            "shop_id": self.shop_id,
            "main_images": self.main_images,
            "detail_images": self.detail_images,
            "sku_images": self.sku_images,
            "specs": self.specs,
            "skus": [
                {
                    "sku_id": s.sku_id,
                    "specs": {sp.name: sp.value for sp in s.specs},
                    "price": s.price,
                    "original_price": s.original_price,
                    "stock": s.stock,
                    "image": s.image,
                }
                for s in self.skus
            ],
            "description": self.description,
            "attributes": self.attributes,
            "source_url": self.source_url,
            "crawl_time": self.crawl_time,
        }
