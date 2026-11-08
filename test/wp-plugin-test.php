<?php
// Unit test for wordpress/hc-jobs/hc-jobs.php using a tiny in-memory stand-in for the WordPress functions it calls.
// Run: php test/wp-plugin-test.php   (does NOT replace testing on a real WordPress + WP Job Manager site)
define('ABSPATH', __DIR__);
$GLOBALS['posts'] = []; $GLOBALS['meta'] = []; $GLOBALS['terms'] = []; $GLOBALS['hooks'] = []; $GLOBALS['routes'] = []; $GLOBALS['next'] = 100;
class WP_Error { public $code, $msg, $data; function __construct($c = '', $m = '', $d = []) { $this->code = $c; $this->msg = $m; $this->data = $d; } function get_error_message() { return $this->msg; } }
class WP_REST_Request implements ArrayAccess { private $j, $p; function __construct($json = [], $params = []) { $this->j = $json; $this->p = $params; } function get_json_params() { return $this->j; }
  function offsetExists($o): bool { return isset($this->p[$o]); } function offsetGet($o): mixed { return $this->p[$o]; } function offsetSet($o, $v): void {} function offsetUnset($o): void {} }
function add_action($h, $cb, $p = 10, $n = 1) { $GLOBALS['hooks'][$h][] = $cb; } function add_filter($h, $cb, $p = 10, $n = 1) { $GLOBALS['hooks'][$h][] = $cb; }
function add_shortcode($t, $cb) {} function register_rest_route($ns, $r, $a) { $GLOBALS['routes'][$r] = $a; }
function is_wp_error($x) { return $x instanceof WP_Error; }
function post_type_exists($t) { return $GLOBALS['wpjm'] ?? true; } function taxonomy_exists($t) { return $t === 'job_listing_type'; }
function get_post_stati() { return ['publish' => 1, 'draft' => 1, 'expired' => 1, 'trash' => 1]; } function get_post_status_object($s) { return $s === 'expired' ? (object) [] : null; }
function get_posts($q) { $out = []; foreach ($GLOBALS['posts'] as $id => $p) if (($GLOBALS['meta'][$id][$q['meta_key']] ?? null) === ($q['meta_value'] ?? ($GLOBALS['meta'][$id][$q['meta_key']] ?? null))) $out[] = $id; return $out; }
function get_post_status($id) { return $GLOBALS['posts'][$id]['post_status'] ?? false; }
function wp_untrash_post($id) { $GLOBALS['posts'][$id]['post_status'] = 'draft'; } function wp_trash_post($id) { $GLOBALS['posts'][$id]['post_status'] = 'trash'; }
function wp_insert_post($p, $e) { $id = $GLOBALS['next']++; $GLOBALS['posts'][$id] = $p; return $id; }
function wp_update_post($p, $e) { $GLOBALS['posts'][$p['ID']] = array_merge($GLOBALS['posts'][$p['ID']], $p); return $p['ID']; }
function update_post_meta($id, $k, $v) { $GLOBALS['meta'][$id][$k] = $v; } function get_post_meta($id, $k, $s) { return $GLOBALS['meta'][$id][$k] ?? ''; }
function wp_set_object_terms($id, $t, $tax, $app) { $GLOBALS['terms'][$id][$tax] = $t; }
function get_permalink($id) { return 'https://agency.test/job/' . sanitize_title($GLOBALS['posts'][$id]['post_title']) . '/'; }
function sanitize_title($s) { return trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($s)), '-'); }
function wp_slash($v) { return $v; } function wp_unslash($v) { return $v; } function update_option($k, $v, $a = null) {} function get_option($k) { return ''; } function clean_post_cache($id) {}
function get_current_user_id() { return 1; } function current_user_can($c) { return true; } function home_url($p = '') { return 'https://agency.test' . $p; } function get_bloginfo($k) { return '6.5'; }
function wp_strip_all_tags($s) { return trim(strip_tags($s)); } function wp_kses_post($s) { return preg_replace('#<script.*?</script>#is', '', $s); }
function sanitize_text_field($s) { return trim(strip_tags($s)); } function esc_url_raw($u) { return preg_match('#^https?://#', $u) ? $u : ''; } function wp_json_encode($x) { return json_encode($x); }
function esc_attr($s) { return htmlspecialchars($s, ENT_QUOTES); } function esc_html__($s, $d) { return $s; } function get_post($p = null) { return $p ? (object) ['ID' => is_object($p) ? $p->ID : $p] : null; }
// like WordPress: values are NOT encoded by add_query_arg (the plugin rawurlencodes them first)
function add_query_arg($args, $url) { $q = []; foreach ($args as $k => $v) $q[] = $k . '=' . $v; return $url . (strpos($url, '?') === false ? '?' : '&') . implode('&', $q); }
function wp_enqueue_script(...$a) { $GLOBALS['scripts'][] = $a[1]; } function get_the_ID() { return 0; }

require __DIR__ . '/../wordpress/hc-jobs/hc-jobs.php';
foreach ($GLOBALS['hooks']['rest_api_init'] as $cb) $cb();
$fails = 0; function check($label, $ok) { global $fails; echo ($ok ? '  ✓ ' : '  ✗ ') . $label . "\n"; if (!$ok) $fails++; }

$payload = ['external_id' => 'rec123', 'title' => 'Caregiver <b>Weekend</b>', 'status' => 'publish', 'filled' => false,
  'content_html' => '<p>Help seniors</p><script>alert(1)</script>', 'location' => 'Columbus, OH', 'company_name' => 'Sunrise Home Care',
  'company_website' => 'https://sunrise.test', 'job_type' => 'Part Time', 'category' => 'Caregiver', 'salary_min' => 16, 'salary_max' => 19, 'salary_unit' => 'HOUR',
  'expires' => '2026-12-31', 'apply_url' => 'https://link.carefunnels.com/widget/form/ABC?job_title=Caregiver',
  'form' => ['src' => 'https://link.carefunnels.com/widget/form/ABC', 'attrs' => ['id' => 'inline-ABC', 'data-form-id' => 'ABC', 'onload' => 'evil()'], 'script_src' => 'https://link.msgsndr.com/js/form_embed.js', 'height' => 1100],
  'prefill' => ['job_title' => 'Caregiver Weekend', 'job_id' => 'rec123']];

echo "create\n";
$r = hcj_rest_upsert(new WP_REST_Request($payload));
$id = $r['post_id'];
check('returns post id + URL', $id === 100 && $r['url'] === 'https://agency.test/job/caregiver-weekend/');
check('title stripped of HTML', $GLOBALS['posts'][$id]['post_title'] === 'Caregiver Weekend');
check('script removed from content', strpos($GLOBALS['posts'][$id]['post_content'], 'script') === false);
check('published', $GLOBALS['posts'][$id]['post_status'] === 'publish');
check('WPJM location/company/expiry meta', $GLOBALS['meta'][$id]['_job_location'] === 'Columbus, OH' && $GLOBALS['meta'][$id]['_company_name'] === 'Sunrise Home Care' && $GLOBALS['meta'][$id]['_job_expires'] === '2026-12-31');
check('pay range kept for Google, single salary blank', $GLOBALS['meta'][$id]['_hcj_salary_min'] === '16' && $GLOBALS['meta'][$id]['_hcj_salary_max'] === '19' && $GLOBALS['meta'][$id]['_job_salary'] === '');
check('job type term set; category skipped when taxonomy off', $GLOBALS['terms'][$id]['job_listing_type'] === ['Part Time'] && !isset($GLOBALS['terms'][$id]['job_listing_category']));

echo "update (same external id) + close\n";
$r2 = hcj_rest_upsert(new WP_REST_Request(array_merge($payload, ['title' => 'Caregiver – Weekdays', 'status' => 'expired', 'filled' => true])));
check('updates the same post (no duplicate)', $r2['post_id'] === $id && count($GLOBALS['posts']) === 1);
check('filled job → expired + _filled', $GLOBALS['posts'][$id]['post_status'] === 'expired' && $GLOBALS['meta'][$id]['_filled'] === 1);

echo "delete + recreate\n";
hcj_rest_delete(new WP_REST_Request([], ['external_id' => 'rec123']));
check('delete moves to trash', $GLOBALS['posts'][$id]['post_status'] === 'trash');
$r3 = hcj_rest_upsert(new WP_REST_Request($payload));
check('re-sync restores from trash instead of duplicating', $r3['post_id'] === $id && $GLOBALS['posts'][$id]['post_status'] === 'publish');

echo "validation\n";
check('missing title rejected', is_wp_error(hcj_rest_upsert(new WP_REST_Request(array_merge($payload, ['title' => ' '])))));
check('bad external id rejected', is_wp_error(hcj_rest_upsert(new WP_REST_Request(array_merge($payload, ['external_id' => '../x'])))));
$GLOBALS['wpjm'] = false; $e = hcj_rest_upsert(new WP_REST_Request($payload)); $GLOBALS['wpjm'] = true;
check('WP Job Manager inactive → 409', is_wp_error($e) && $e->data['status'] === 409);

echo "application form on job page\n";
$_GET['utm_source'] = 'facebook';
$html = hcj_form_html($id);
check('iframe with CareFunnels src + job prefill + utm', strpos($html, 'src="https://link.carefunnels.com/widget/form/ABC?job_title=Caregiver%20Weekend&amp;job_id=rec123') !== false && strpos($html, 'utm_source=facebook') !== false);
check('keeps id/data-* attrs, drops event handlers', strpos($html, 'id="inline-ABC"') !== false && strpos($html, 'data-form-id="ABC"') !== false && strpos($html, 'onload') === false);
check('loads form_embed.js', in_array('https://link.msgsndr.com/js/form_embed.js', $GLOBALS['scripts'] ?? [], true));
$GLOBALS['meta'][$id]['_filled'] = 1; $html2 = hcj_form_html($id + 0);
check('default WPJM apply button hidden for synced jobs', $GLOBALS['hooks']['the_job_application_method'][0]('email@x.com', $id) === false);
$data = $GLOBALS['hooks']['wpjm_get_job_listing_structured_data'][0](['title' => 'x'], $id);
check('Google data gets pay range', $data['baseSalary']['value']['minValue'] == 16 && $data['baseSalary']['value']['maxValue'] == 19);

echo $fails ? "\n$fails FAILED\n" : "\nall passed\n"; exit($fails ? 1 : 0);
