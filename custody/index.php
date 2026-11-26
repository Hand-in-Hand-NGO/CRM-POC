<?php
require __DIR__ . '/lib.php';
db();
start_session();
mark_activity();
header('X-Frame-Options: SAMEORIGIN');
page_head(cfg('app_name'));
?>
<body class="app">

<div id="loginView" class="login-wrap" style="display:none">
    <form class="login-box" id="loginForm" autocomplete="on">
        <div class="login-head">
            <i class="fa fa-briefcase fa-2x"></i>
            <div><b><?= h(cfg('app_name')) ?></b><div class="info-label"><?= h(cfg('org_name')) ?></div></div>
        </div>
        <div class="alert alert-warning" id="loginNotice" role="alert" style="display:none"></div>
        <div class="form-group">
            <label>اسم المستخدم</label>
            <input class="form-control" name="username" autocomplete="username" required autofocus dir="ltr">
        </div>
        <div class="form-group">
            <label>كلمة المرور</label>
            <input class="form-control" type="password" name="password" autocomplete="current-password" required dir="ltr">
        </div>
        <div class="alert alert-danger" id="loginError" style="display:none"></div>
        <button class="btn btn-success btn-block btn-action" type="submit"><i class="fa fa-sign-in"></i> دخول</button>
    </form>
</div>

<div id="appView" style="display:none">
    <header class="main-header">
        <button class="btn btn-link sidebar-toggle" id="sidebarToggle"><i class="fa fa-bars"></i></button>
        <span class="logo"><i class="fa fa-briefcase"></i> <?= h(cfg('app_name')) ?></span>
        <div class="header-user">
            <i class="fa fa-user-circle"></i> <span id="userName"></span>
            <button class="btn btn-link btn-sm" id="btnChangePw" title="تغيير كلمة المرور"><i class="fa fa-key"></i></button>
            <button class="btn btn-link btn-sm" id="btnLogout" title="خروج"><i class="fa fa-sign-out"></i></button>
        </div>
    </header>
    <div class="imp-bar" id="impBar" style="display:none">
        <span><i class="fa fa-user-secret"></i> أنت تستخدم النظام باسم: <b id="impName"></b></span>
        <button class="btn btn-default btn-xs btn-action" id="btnStopImp"><i class="fa fa-arrow-right"></i> العودة لحساب المدير</button>
    </div>
    <aside class="main-sidebar">
        <ul class="sidebar-menu" id="menu">
            <li data-view="dashboard"><a href="#dashboard"><i class="fa fa-dashboard"></i> <span>لوحة المتابعة</span></a></li>
            <li data-view="custody"><a href="#custody"><i class="fa fa-exchange"></i> <span>العهد</span></a></li>
            <li data-view="handovers"><a href="#handovers"><i class="fa fa-file-text-o"></i> <span>السندات والتوقيعات</span></a></li>
            <li data-view="items"><a href="#items"><i class="fa fa-cubes"></i> <span>الأصناف والأصول</span></a></li>
            <li data-view="employees"><a href="#employees"><i class="fa fa-users"></i> <span>الموظفين</span></a></li>
            <li data-view="data" class="edit-only"><a href="#data"><i class="fa fa-file-excel-o"></i> <span>استيراد وتصدير Excel</span></a></li>
            <li data-view="users" class="admin-only"><a href="#users"><i class="fa fa-user-secret"></i> <span>المستخدمين</span></a></li>
            <li data-view="log" class="admin-only"><a href="#log"><i class="fa fa-history"></i> <span>سجل العمليات</span></a></li>
        </ul>
    </aside>
    <main class="content-wrapper" id="content"></main>
</div>

<div class="modal fade" id="modal" tabindex="-1">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal">&times;</button>
                <h4 class="modal-title"></h4>
            </div>
            <div class="modal-body"></div>
            <div class="modal-footer"></div>
        </div>
    </div>
</div>

<div class="session-warn" id="sessionWarn" role="alertdialog" aria-live="assertive" style="display:none">
    <span><i class="fa fa-clock-o"></i> ستنتهي جلستك خلال <b id="sessionWarnLeft" dir="ltr"></b> بسبب عدم النشاط.</span>
    <button class="btn btn-default btn-sm btn-action" id="btnKeepSession"><i class="fa fa-refresh"></i> استمرار الجلسة</button>
</div>

<div id="toast"></div>

<script src="assets/vendor/jquery.min.js"></script>
<script src="assets/vendor/bootstrap/js/bootstrap.min.js"></script>
<link rel="stylesheet" href="assets/vendor/select2/select2.min.css">
<script src="assets/vendor/select2/select2.min.js"></script>
<script src="<?= asset('assets/app.js') ?>"></script>
</body>
</html>
