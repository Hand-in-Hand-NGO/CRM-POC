<?php
// جداول قاعدة البيانات — تعمل على SQLite و MySQL.
// {PK} و {TBL} تُستبدل حسب نوع القاعدة في install_schema().

return [
    "CREATE TABLE IF NOT EXISTS meta (
        k VARCHAR(64) NOT NULL PRIMARY KEY,
        v VARCHAR(255)
    ){TBL}",

    "CREATE TABLE IF NOT EXISTS users (
        id {PK},
        username VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(190) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(16) NOT NULL DEFAULT 'editor',
        active INT NOT NULL DEFAULT 1,
        must_change INT NOT NULL DEFAULT 0,
        last_login VARCHAR(19),
        created_at VARCHAR(19) NOT NULL
    ){TBL}",

    "CREATE TABLE IF NOT EXISTS employees (
        id {PK},
        code VARCHAR(64),
        name VARCHAR(190) NOT NULL,
        national_id VARCHAR(32),
        department VARCHAR(190),
        job_title VARCHAR(190),
        branch VARCHAR(190),
        phone VARCHAR(32),
        email VARCHAR(190),
        active INT NOT NULL DEFAULT 1,
        notes TEXT,
        created_at VARCHAR(19) NOT NULL
    ){TBL}",

    "CREATE TABLE IF NOT EXISTS categories (
        id {PK},
        name VARCHAR(190) NOT NULL UNIQUE
    ){TBL}",

    "CREATE TABLE IF NOT EXISTS items (
        id {PK},
        code VARCHAR(64) NOT NULL UNIQUE,
        type VARCHAR(16) NOT NULL DEFAULT 'laptop',
        category_id INT,
        name VARCHAR(190) NOT NULL,
        brand VARCHAR(190),
        model VARCHAR(190),
        serial_no VARCHAR(190),
        purchase_date VARCHAR(10),
        value DECIMAL(12,2),
        item_condition VARCHAR(32) NOT NULL DEFAULT 'جيد',
        status VARCHAR(32) NOT NULL DEFAULT 'متاحة',
        location VARCHAR(190),
        specs TEXT,
        notes TEXT,
        created_at VARCHAR(19) NOT NULL,
        linked_sim_id INT
    ){TBL}",

    // سند تسليم (out) أو سند ارتجاع (in) — يجمع عدة أصناف ويوقّعه الموظف إلكترونيًا
    "CREATE TABLE IF NOT EXISTS handovers (
        id {PK},
        doc_no VARCHAR(32),
        type VARCHAR(8) NOT NULL,
        employee_id INT NOT NULL,
        doc_date VARCHAR(10) NOT NULL,
        notes TEXT,
        created_by INT,
        created_at VARCHAR(19) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        ack_at VARCHAR(19),
        ack_name VARCHAR(190),
        ack_ip VARCHAR(64),
        ack_agent VARCHAR(255),
        ack_signature MEDIUMTEXT,
        paper_scan_id INT,
        paper_signed_on VARCHAR(10)
    ){TBL}",

    // الإقرار الورقي الموقّع (Scan) لكل سند، بكل إصداراته. الإصدار الحالي هو handovers.paper_scan_id
    // توثيق ورقي بواسطة المستخدم اللي رفعه، مش توقيع إلكتروني ولا تحقق آلي من التوقيع
    "CREATE TABLE IF NOT EXISTS handover_scans (
        id {PK},
        handover_id INT NOT NULL,
        employee_id INT NOT NULL,
        version INT NOT NULL,
        signed_on VARCHAR(10) NOT NULL,
        notes TEXT,
        reason TEXT,
        dir VARCHAR(255) NOT NULL,
        source VARCHAR(8) NOT NULL,
        pages INT,
        pdf_size INT NOT NULL,
        pdf_sha256 VARCHAR(64) NOT NULL,
        originals TEXT NOT NULL,
        snapshot MEDIUMTEXT NOT NULL,
        uploaded_by INT NOT NULL,
        uploaded_at VARCHAR(19) NOT NULL,
        replaced_by INT,
        replaced_at VARCHAR(19)
    ){TBL}",

    // كل صنف في عهدة موظف: من سند تسليم حتى سند ارتجاع
    "CREATE TABLE IF NOT EXISTS custody (
        id {PK},
        item_id INT NOT NULL,
        employee_id INT NOT NULL,
        out_handover_id INT NOT NULL,
        in_handover_id INT,
        assigned_at VARCHAR(10) NOT NULL,
        condition_out VARCHAR(32),
        notes_out TEXT,
        returned_at VARCHAR(10),
        condition_in VARCHAR(32),
        notes_in TEXT
    ){TBL}",

    "CREATE TABLE IF NOT EXISTS activity_log (
        id {PK},
        user_id INT,
        action VARCHAR(64) NOT NULL,
        entity VARCHAR(32),
        entity_id INT,
        details TEXT,
        created_at VARCHAR(19) NOT NULL,
        impersonator_id INT
    ){TBL}",

    "CREATE INDEX idx_custody_emp ON custody (employee_id)",
    "CREATE INDEX idx_custody_item ON custody (item_id)",
    "CREATE INDEX idx_handover_emp ON handovers (employee_id)",
    "CREATE UNIQUE INDEX idx_scans_version ON handover_scans (handover_id, version)",
    // الشريحة الواحدة تُربط بماكينة POS واحدة فقط
    "CREATE UNIQUE INDEX idx_items_linked_sim ON items (linked_sim_id)",
];
