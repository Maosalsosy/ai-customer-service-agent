BEGIN;

DO $$
DECLARE
  main_base_id TEXT;
BEGIN
  SELECT id
  INTO main_base_id
  FROM knowledge_bases
  WHERE tenant_id = 'tenant-demo'
    AND is_default = TRUE;

  IF main_base_id IS NOT NULL THEN

    UPDATE knowledge_documents
    SET knowledge_base_id = main_base_id,
        category_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = 'tenant-demo';

    /* Categories are no longer part of the single knowledge-base workflow.
       Moving categories can violate the per-base unique name constraint. */
    DELETE FROM knowledge_categories
    WHERE tenant_id = 'tenant-demo';

    UPDATE knowledge_gaps
    SET knowledge_base_id = main_base_id,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = 'tenant-demo';

    UPDATE wecom_connections
    SET knowledge_base_id = main_base_id,
        knowledge_base_ids = ARRAY[main_base_id]::TEXT[],
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = 'tenant-demo';

    DELETE FROM knowledge_bases
    WHERE tenant_id = 'tenant-demo'
      AND id <> main_base_id;
  END IF;
END $$;

COMMIT;
