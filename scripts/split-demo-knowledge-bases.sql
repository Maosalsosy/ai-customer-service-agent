BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'tenant-demo') THEN
    RAISE EXCEPTION 'tenant-demo does not exist';
  END IF;
  IF (SELECT COUNT(*) FROM knowledge_documents WHERE tenant_id = 'tenant-demo') <> 6 THEN
    RAISE EXCEPTION 'Expected exactly 6 tenant-demo knowledge documents';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM wecom_connections WHERE id = 'conn-mock-1' AND tenant_id = 'tenant-demo') THEN
    RAISE EXCEPTION 'Expected conn-mock-1 for tenant-demo';
  END IF;
END $$;

INSERT INTO knowledge_bases (id, tenant_id, name, is_default, updated_at) VALUES
  ('kb-demo-products-20261021', 'tenant-demo', '产品与定制', false, CURRENT_TIMESTAMP),
  ('kb-demo-sampling-20261021', 'tenant-demo', '打样与报价', false, CURRENT_TIMESTAMP),
  ('kb-demo-procurement-20261021', 'tenant-demo', '采购与财务', false, CURRENT_TIMESTAMP),
  ('kb-demo-delivery-20261021', 'tenant-demo', '交付与售后', false, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_categories (id, tenant_id, knowledge_base_id, name, sort_order, updated_at) VALUES
  ('kc-demo-products-20261021', 'tenant-demo', 'kb-demo-products-20261021', '产品规则与定制', 10, CURRENT_TIMESTAMP),
  ('kc-demo-sampling-20261021', 'tenant-demo', 'kb-demo-sampling-20261021', '打样与价格', 10, CURRENT_TIMESTAMP),
  ('kc-demo-procurement-20261021', 'tenant-demo', 'kb-demo-procurement-20261021', '采购、合同与开票', 10, CURRENT_TIMESTAMP),
  ('kc-demo-delivery-20261021', 'tenant-demo', 'kb-demo-delivery-20261021', '交付与售后', 10, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

UPDATE knowledge_documents
SET knowledge_base_id = CASE id
      WHEN 'k1' THEN 'kb-demo-products-20261021'
      WHEN 'k-65b534a0' THEN 'kb-demo-products-20261021'
      WHEN 'k2' THEN 'kb-demo-sampling-20261021'
      WHEN 'k4' THEN 'kb-demo-sampling-20261021'
      WHEN 'k3' THEN 'kb-demo-procurement-20261021'
      WHEN 'k5' THEN 'kb-demo-delivery-20261021'
    END,
    category_id = CASE id
      WHEN 'k1' THEN 'kc-demo-products-20261021'
      WHEN 'k-65b534a0' THEN 'kc-demo-products-20261021'
      WHEN 'k2' THEN 'kc-demo-sampling-20261021'
      WHEN 'k4' THEN 'kc-demo-sampling-20261021'
      WHEN 'k3' THEN 'kc-demo-procurement-20261021'
      WHEN 'k5' THEN 'kc-demo-delivery-20261021'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = 'tenant-demo'
  AND id IN ('k1', 'k2', 'k3', 'k4', 'k5', 'k-65b534a0');

DELETE FROM knowledge_chunks
WHERE tenant_id = 'tenant-demo'
  AND document_id IN ('k1', 'k2', 'k3', 'k4', 'k5', 'k-65b534a0');

UPDATE wecom_connections
SET knowledge_base_id = 'kb-demo-products-20261021',
    knowledge_base_ids = ARRAY[
      'kb-demo-products-20261021',
      'kb-demo-sampling-20261021',
      'kb-demo-procurement-20261021',
      'kb-demo-delivery-20261021'
    ]::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'conn-mock-1'
  AND tenant_id = 'tenant-demo';

DELETE FROM knowledge_categories
WHERE tenant_id = 'tenant-demo'
  AND knowledge_base_id = 'kb-eeecc5155194089fa3eb4e9dbe632ff5'
  AND id NOT IN (
    'kc-demo-products-20261021',
    'kc-demo-sampling-20261021',
    'kc-demo-procurement-20261021',
    'kc-demo-delivery-20261021'
  );

COMMIT;
