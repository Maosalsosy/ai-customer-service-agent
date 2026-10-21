BEGIN;

DO $$
DECLARE
  tenant_row RECORD;
  main_base_id TEXT;
BEGIN
  FOR tenant_row IN SELECT id FROM tenants LOOP
    INSERT INTO knowledge_bases (id, tenant_id, name, is_default, updated_at)
    SELECT 'kb-' || md5(tenant_row.id || ':default'), tenant_row.id, '项目知识库', TRUE, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1 FROM knowledge_bases
      WHERE tenant_id = tenant_row.id AND is_default = TRUE
    );

    SELECT id
    INTO main_base_id
    FROM knowledge_bases
    WHERE tenant_id = tenant_row.id
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;

    UPDATE knowledge_bases
    SET is_default = FALSE,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = tenant_row.id AND id <> main_base_id;

    /* Every dependent record below is moved before the old spaces are removed. */
    UPDATE knowledge_documents
    SET knowledge_base_id = main_base_id,
        category_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = tenant_row.id;

    UPDATE knowledge_gaps
    SET knowledge_base_id = main_base_id,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = tenant_row.id;

    UPDATE wecom_connections
    SET knowledge_base_id = main_base_id,
        knowledge_base_ids = ARRAY[main_base_id]::TEXT[],
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = tenant_row.id;

    DELETE FROM knowledge_categories WHERE tenant_id = tenant_row.id;

    DELETE FROM knowledge_bases
    WHERE tenant_id = tenant_row.id
      AND id <> main_base_id;

    UPDATE knowledge_bases
    SET is_default = TRUE,
        name = '项目知识库',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = main_base_id;
  END LOOP;
END $$;

COMMIT;
