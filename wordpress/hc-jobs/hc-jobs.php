<?php
/**
 * Plugin Name: Home Care Job Board
 * Description: Embed your agency's job board anywhere with [hc_jobs]. Settings → Job Board.
 * Version: 1.0.0
 */
if (!defined('ABSPATH')) exit;

add_action('admin_menu', function () {
    add_options_page('Job Board', 'Job Board', 'manage_options', 'hc-jobs', 'hc_jobs_settings_page');
});
add_action('admin_init', function () {
    register_setting('hc_jobs', 'hc_jobs_host', ['sanitize_callback' => 'esc_url_raw']);
    register_setting('hc_jobs', 'hc_jobs_agency', ['sanitize_callback' => 'sanitize_title']);
});
function hc_jobs_settings_page() { ?>
  <div class="wrap"><h1>Home Care Job Board</h1>
  <form method="post" action="options.php"><?php settings_fields('hc_jobs'); ?>
  <table class="form-table">
    <tr><th>Job board host</th><td><input class="regular-text" name="hc_jobs_host" value="<?php echo esc_attr(get_option('hc_jobs_host')); ?>" placeholder="https://jobs.yourplatform.com"></td></tr>
    <tr><th>Agency slug</th><td><input class="regular-text" name="hc_jobs_agency" value="<?php echo esc_attr(get_option('hc_jobs_agency')); ?>"></td></tr>
  </table><?php submit_button(); ?></form>
  <p>Add <code>[hc_jobs]</code> to your Careers page. Teaser: <code>[hc_jobs limit="3" link="/careers"]</code></p></div>
<?php }

add_shortcode('hc_jobs', function ($atts) {
    $a = shortcode_atts(['agency' => get_option('hc_jobs_agency'), 'limit' => '', 'link' => '', 'category' => '', 'color' => ''], $atts);
    $host = rtrim(get_option('hc_jobs_host'), '/');
    if (!$host || !$a['agency']) return current_user_can('manage_options') ? '<p><em>Job board: set host and agency in Settings → Job Board.</em></p>' : '';
    wp_enqueue_script('hc-jobs-embed', $host . '/embed.js', [], null, ['strategy' => 'defer', 'in_footer' => true]);
    $attrs = '';
    foreach (['agency', 'limit', 'link', 'category', 'color'] as $k) if ($a[$k] !== '') $attrs .= ' data-' . $k . '="' . esc_attr($a[$k]) . '"';
    return '<div class="hc-jobs"' . $attrs . '></div>';
});
