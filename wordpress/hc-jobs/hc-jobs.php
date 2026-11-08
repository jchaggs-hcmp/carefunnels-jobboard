<?php
/**
 * Plugin Name: CareFunnels Job Sync
 * Description: Receives jobs from the CareFunnels job hub and publishes them as WP Job Manager listings, with the agency's CareFunnels application form on each job page. Also provides the [hc_jobs] embed shortcode.
 * Version: 2.0.0
 * Requires at least: 5.6
 * Requires PHP: 7.4
 * Requires Plugins: wp-job-manager
 */
if (!defined('ABSPATH')) exit;

define('HCJ_VERSION', '2.0.0');
define('HCJ_META_ID', '_hcj_external_id');

/* =========================================================================
 * REST API used by the hub:  /wp-json/hcjobs/v1/...
 * Auth: WordPress Application Password of an Administrator (HTTP Basic over HTTPS).
 * ========================================================================= */
add_action('rest_api_init', function () {
    $admin = function () { return current_user_can('manage_options'); };
    register_rest_route('hcjobs/v1', '/status', ['methods' => 'GET', 'callback' => 'hcj_rest_status', 'permission_callback' => $admin]);
    register_rest_route('hcjobs/v1', '/jobs', ['methods' => 'POST', 'callback' => 'hcj_rest_upsert', 'permission_callback' => $admin]);
    register_rest_route('hcjobs/v1', '/jobs/(?P<external_id>[A-Za-z0-9_\-]+)', ['methods' => 'DELETE', 'callback' => 'hcj_rest_delete', 'permission_callback' => $admin]);
});

function hcj_wpjm_active() { return post_type_exists('job_listing'); }

function hcj_rest_status() {
    return [
        'ok'             => true,
        'site'           => home_url('/'),
        'wp_version'     => get_bloginfo('version'),
        'plugin_version' => HCJ_VERSION,
        'wpjm_active'    => hcj_wpjm_active(),
        'wpjm_version'   => defined('JOB_MANAGER_VERSION') ? JOB_MANAGER_VERSION : null,
        'jobs_synced'    => count(hcj_synced_post_ids()),
    ];
}

/** Finds the job_listing created for a hub job (any status, including trash). */
function hcj_find_post($external_id) {
    $ids = get_posts([
        'post_type'        => 'job_listing',
        'post_status'      => array_keys(get_post_stati()),
        'meta_key'         => HCJ_META_ID,
        'meta_value'       => (string) $external_id,
        'fields'           => 'ids',
        'posts_per_page'   => 1,
        'suppress_filters' => true,
        'no_found_rows'    => true,
    ]);
    return $ids ? (int) $ids[0] : 0;
}

function hcj_synced_post_ids() {
    return get_posts(['post_type' => 'job_listing', 'post_status' => 'any', 'meta_key' => HCJ_META_ID, 'fields' => 'ids', 'posts_per_page' => -1, 'suppress_filters' => true, 'no_found_rows' => true]);
}

/** Pure mapping of the hub payload → post fields + meta + terms (kept separate so it can be unit tested). */
function hcj_map_payload(array $p, $expired_status_exists) {
    $status = in_array($p['status'] ?? '', ['publish', 'draft', 'expired'], true) ? $p['status'] : 'draft';
    if ($status === 'expired' && !$expired_status_exists) $status = 'draft';

    $min = isset($p['salary_min']) && $p['salary_min'] !== '' && $p['salary_min'] !== null ? (float) $p['salary_min'] : null;
    $max = isset($p['salary_max']) && $p['salary_max'] !== '' && $p['salary_max'] !== null ? (float) $p['salary_max'] : null;
    $unit = strtoupper((string) ($p['salary_unit'] ?? 'HOUR'));
    if (!in_array($unit, ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'], true)) $unit = 'HOUR';
    $single = ($min !== null && ($max === null || $max == $min)) ? $min : (($min === null && $max !== null) ? $max : null);

    $expires = (isset($p['expires']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $p['expires'])) ? $p['expires'] : '';

    return [
        'post' => [
            'post_type'    => 'job_listing',
            'post_title'   => wp_strip_all_tags((string) ($p['title'] ?? '')),
            'post_content' => wp_kses_post((string) ($p['content_html'] ?? '')),
            'post_status'  => $status,
        ],
        'meta' => [
            HCJ_META_ID            => (string) $p['external_id'],
            '_job_location'        => sanitize_text_field((string) ($p['location'] ?? '')),
            '_company_name'        => sanitize_text_field((string) ($p['company_name'] ?? '')),
            '_company_website'     => esc_url_raw((string) ($p['company_website'] ?? '')),
            '_application'         => esc_url_raw((string) ($p['apply_url'] ?? '')),
            '_job_expires'         => $expires,
            '_filled'              => !empty($p['filled']) ? 1 : 0,
            // WP Job Manager's own salary fields (single value); ranges are added to Google's data via the filter below.
            '_job_salary'          => $single !== null ? (string) $single : '',
            '_job_salary_currency' => 'USD',
            '_job_salary_unit'     => $unit,
            '_hcj_salary_min'      => $min === null ? '' : (string) $min,
            '_hcj_salary_max'      => $max === null ? '' : (string) $max,
            '_hcj_form'            => !empty($p['form']['src']) ? wp_json_encode($p['form']) : '',
            '_hcj_prefill'         => !empty($p['prefill']) && is_array($p['prefill']) ? wp_json_encode($p['prefill']) : '',
            '_hcj_synced_at'       => gmdate('c'),
        ],
        'terms' => [
            'job_listing_type'     => sanitize_text_field((string) ($p['job_type'] ?? '')),
            'job_listing_category' => sanitize_text_field((string) ($p['category'] ?? '')),
        ],
    ];
}

function hcj_rest_upsert(WP_REST_Request $req) {
    if (!hcj_wpjm_active()) return new WP_Error('hcj_no_wpjm', 'WP Job Manager is not active on this site.', ['status' => 409]);
    $p = $req->get_json_params();
    if (!is_array($p) || empty($p['external_id']) || !preg_match('/^[A-Za-z0-9_\-]+$/', (string) $p['external_id'])) return new WP_Error('hcj_bad_id', 'external_id is required.', ['status' => 400]);
    if (trim((string) ($p['title'] ?? '')) === '') return new WP_Error('hcj_bad_title', 'title is required.', ['status' => 400]);

    $m = hcj_map_payload($p, (bool) get_post_status_object('expired'));
    $id = hcj_find_post($p['external_id']);
    if ($id && get_post_status($id) === 'trash') wp_untrash_post($id);

    if ($id) {
        $m['post']['ID'] = $id;
        $res = wp_update_post(wp_slash($m['post']), true);
    } else {
        $m['post']['post_author'] = get_current_user_id();
        $res = wp_insert_post(wp_slash($m['post']), true);
    }
    if (is_wp_error($res)) return new WP_Error('hcj_save_failed', $res->get_error_message(), ['status' => 500]);
    $id = (int) $res;

    foreach ($m['meta'] as $k => $v) update_post_meta($id, $k, wp_slash($v));
    foreach ($m['terms'] as $tax => $name) {
        if (!taxonomy_exists($tax)) continue;               // e.g. categories switched off in WP Job Manager settings
        wp_set_object_terms($id, $name !== '' ? [$name] : [], $tax, false); // creates the term if it doesn't exist yet
    }
    update_option('hcj_last_push', gmdate('c'), false);
    clean_post_cache($id);

    return ['post_id' => $id, 'url' => get_permalink($id), 'status' => get_post_status($id)];
}

function hcj_rest_delete(WP_REST_Request $req) {
    $id = hcj_find_post($req['external_id']);
    if ($id) wp_trash_post($id);
    update_option('hcj_last_push', gmdate('c'), false);
    return ['ok' => true, 'post_id' => $id ?: null];
}

/* =========================================================================
 * Job page: show the agency's CareFunnels application form
 * ========================================================================= */

/** Synced jobs with a CareFunnels form hide WP Job Manager's default "Apply for job" button… */
add_filter('the_job_application_method', function ($method, $post = null) {
    $post = get_post($post);
    return ($post && get_post_meta($post->ID, '_hcj_form', true)) ? false : $method;
}, 20, 2);

/** …and show the form itself at the end of the job listing. */
add_action('single_job_listing_end', function () {
    echo hcj_form_html(get_the_ID()); // phpcs:ignore WordPress.Security.EscapeOutput -- built from escaped parts
});
add_shortcode('hcj_apply_form', function () { return hcj_form_html(get_the_ID()); });

function hcj_form_html($post_id) {
    static $done = [];
    if (!$post_id || isset($done[$post_id])) return '';
    $form = json_decode((string) get_post_meta($post_id, '_hcj_form', true), true);
    if (empty($form['src']) || get_post_meta($post_id, '_filled', true)) return '';
    $src = esc_url_raw($form['src']);
    if (stripos($src, 'https://') !== 0) return '';
    $done[$post_id] = true;

    $prefill = json_decode((string) get_post_meta($post_id, '_hcj_prefill', true), true) ?: [];
    $prefill['application_source'] = get_permalink($post_id);
    foreach (['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as $k) {
        if (!empty($_GET[$k])) $prefill[$k] = sanitize_text_field(wp_unslash($_GET[$k])); // phpcs:ignore WordPress.Security.NonceVerification
    }
    $src = add_query_arg(array_map('rawurlencode', array_filter($prefill, 'strlen')), $src);

    $height = !empty($form['height']) ? (int) $form['height'] : 900;
    $attrs = ['src' => $src, 'title' => 'Job application', 'loading' => 'lazy', 'style' => 'width:100%;border:none;border-radius:4px;min-height:' . $height . 'px;height:' . $height . 'px'];
    foreach ((array) ($form['attrs'] ?? []) as $k => $v) {
        if ($k === 'id' || $k === 'title' || preg_match('/^data-[a-z0-9\-]+$/', $k)) $attrs[$k] = (string) $v;
    }
    $html = '<iframe';
    foreach ($attrs as $k => $v) $html .= ' ' . $k . '="' . esc_attr($v) . '"';
    $html .= '></iframe>';

    $script = (string) ($form['script_src'] ?? '');
    if (stripos($script, 'https://') === 0 && preg_match('#/form_embed\.js(\?|$)#', $script)) wp_enqueue_script('hcj-form-embed', esc_url_raw($script), [], null, true);

    return '<div class="hcj-apply" id="apply" style="margin-top:2em"><h2>' . esc_html__('Apply for this position', 'hcj') . '</h2>' . $html . '</div>';
}

/** Adds the pay range to WP Job Manager's Google for Jobs data (it only knows a single salary value). */
add_filter('wpjm_get_job_listing_structured_data', function ($data, $post = null) {
    $post = get_post($post);
    if (!$post || !get_post_meta($post->ID, HCJ_META_ID, true)) return $data;
    $min = get_post_meta($post->ID, '_hcj_salary_min', true);
    $max = get_post_meta($post->ID, '_hcj_salary_max', true);
    if ($min === '' && $max === '') return $data;
    $value = ['@type' => 'QuantitativeValue', 'unitText' => get_post_meta($post->ID, '_job_salary_unit', true) ?: 'HOUR'];
    if ($min !== '') $value['minValue'] = (float) $min;
    if ($max !== '') $value['maxValue'] = (float) $max;
    $data['baseSalary'] = ['@type' => 'MonetaryAmount', 'currency' => 'USD', 'value' => $value];
    return $data;
}, 20, 2);

/* =========================================================================
 * Settings page (Settings → CareFunnels Jobs) + legacy [hc_jobs] embed
 * ========================================================================= */
add_action('admin_menu', function () {
    add_options_page('CareFunnels Jobs', 'CareFunnels Jobs', 'manage_options', 'hc-jobs', 'hcj_settings_page');
});
add_action('admin_init', function () {
    register_setting('hc_jobs', 'hc_jobs_host', ['sanitize_callback' => 'esc_url_raw']);
    register_setting('hc_jobs', 'hc_jobs_agency', ['sanitize_callback' => 'sanitize_title']);
});

function hcj_settings_page() {
    $last = get_option('hcj_last_push');
    $count = count(hcj_synced_post_ids());
    ?>
    <div class="wrap"><h1>CareFunnels Job Sync</h1>
      <h2>Status</h2>
      <table class="widefat striped" style="max-width:720px"><tbody>
        <tr><th>WP Job Manager</th><td><?php echo hcj_wpjm_active() ? '✅ Active' . (defined('JOB_MANAGER_VERSION') ? ' (v' . esc_html(JOB_MANAGER_VERSION) . ')' : '') : '❌ Not active — install and activate WP Job Manager'; ?></td></tr>
        <tr><th>Jobs synced from CareFunnels</th><td><?php echo (int) $count; ?></td></tr>
        <tr><th>Last update from the hub</th><td><?php echo $last ? esc_html(get_date_from_gmt(gmdate('Y-m-d H:i:s', strtotime($last)), 'M j, Y g:i a')) : 'Never'; ?></td></tr>
      </tbody></table>
      <h2>Connect this site to the job hub</h2>
      <ol>
        <li>Go to <a href="<?php echo esc_url(admin_url('profile.php#application-passwords-section')); ?>">Users → Profile → Application Passwords</a> (as an <b>Administrator</b>).</li>
        <li>Name it <code>CareFunnels Job Sync</code> and click <b>Add New Application Password</b>.</li>
        <li>In the job hub admin → <b>Agency settings → WordPress connection</b>, enter this site’s address (<code><?php echo esc_html(home_url()); ?></code>), your WordPress username, and the password you just created.</li>
      </ol>
      <p>Jobs are created, updated and closed automatically — edit them in CareFunnels, not here. Changes made here to synced jobs are overwritten on the next sync.</p>

      <h2>Optional: hub job-board embed</h2>
      <form method="post" action="options.php"><?php settings_fields('hc_jobs'); ?>
      <table class="form-table">
        <tr><th>Job hub address</th><td><input class="regular-text" name="hc_jobs_host" value="<?php echo esc_attr(get_option('hc_jobs_host')); ?>" placeholder="https://jobs.yourplatform.com"></td></tr>
        <tr><th>Agency slug</th><td><input class="regular-text" name="hc_jobs_agency" value="<?php echo esc_attr(get_option('hc_jobs_agency')); ?>"></td></tr>
      </table><?php submit_button(); ?></form>
      <p>Only needed for the <code>[hc_jobs]</code> widget. WP Job Manager’s own <code>[jobs]</code> shortcode lists the synced jobs without it.</p>
    </div>
<?php }

add_shortcode('hc_jobs', function ($atts) {
    $a = shortcode_atts(['agency' => get_option('hc_jobs_agency'), 'limit' => '', 'link' => '', 'category' => '', 'color' => ''], $atts);
    $host = rtrim((string) get_option('hc_jobs_host'), '/');
    if (!$host || !$a['agency']) return current_user_can('manage_options') ? '<p><em>Job board: set the hub address and agency in Settings → CareFunnels Jobs.</em></p>' : '';
    wp_enqueue_script('hc-jobs-embed', $host . '/embed.js', [], null, ['strategy' => 'defer', 'in_footer' => true]);
    $attrs = '';
    foreach (['agency', 'limit', 'link', 'category', 'color'] as $k) if ($a[$k] !== '') $attrs .= ' data-' . $k . '="' . esc_attr($a[$k]) . '"';
    return '<div class="hc-jobs"' . $attrs . '></div>';
});
