// netlify/functions/mailchimp.js
// Pont entre ton tableau de bord et l'API Mailchimp
// Ta clé API Mailchimp est stockée dans les variables d'environnement Netlify (jamais dans le code)

const MAILCHIMP_DC       = "us22";
const MAILCHIMP_LIST_ID  = "5343fbdd97";

exports.handler = async function(event) {

  // Autoriser les requêtes cross-origin (CORS)
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Répondre aux requêtes OPTIONS (preflight CORS)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Vérifier que la clé API est configurée dans Netlify
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Clé API Mailchimp manquante. Configure MAILCHIMP_API_KEY dans les variables d'environnement Netlify." }),
    };
  }

  const auth = Buffer.from(`anystring:${apiKey}`).toString("base64");

  try {
    // ── 1. Stats de la liste (abonnés actifs, désabonnements) ──
    const listRes = await fetch(
      `https://${MAILCHIMP_DC}.api.mailchimp.com/3.0/lists/${MAILCHIMP_LIST_ID}`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const listData = await listRes.json();

    // ── 2. Dernières campagnes (5 plus récentes) ──
    const campaignsRes = await fetch(
      `https://${MAILCHIMP_DC}.api.mailchimp.com/3.0/campaigns?count=5&status=sent&sort_field=send_time&sort_dir=DESC&list_id=${MAILCHIMP_LIST_ID}`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const campaignsData = await campaignsRes.json();

    // ── 3. Calculer les moyennes sur les 5 dernières campagnes ──
    const campaigns = campaignsData.campaigns || [];
    let avgOpenRate  = 0;
    let avgClickRate = 0;

    if (campaigns.length > 0) {
      const totals = campaigns.reduce((acc, c) => {
        const r = c.report_summary || {};
        acc.opens  += r.open_rate  || 0;
        acc.clicks += r.click_rate || 0;
        return acc;
      }, { opens: 0, clicks: 0 });

      avgOpenRate  = totals.opens  / campaigns.length;
      avgClickRate = totals.clicks / campaigns.length;
    }

    // ── 4. Historique d'abonnés sur 30 jours ──
    const growthRes = await fetch(
      `https://${MAILCHIMP_DC}.api.mailchimp.com/3.0/lists/${MAILCHIMP_LIST_ID}/growth-history?count=3`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const growthData = await growthRes.json();
    const growth = (growthData.history || []).slice(0, 3);

    // ── 5. Construire la réponse ──
    const stats = listData.stats || {};

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        // Métriques principales
        totalSubscribers:  listData.stats?.member_count       || 0,
        unsubscribeRate:   (stats.unsubscribe_rate * 100).toFixed(2) || "0.00",
        avgOpenRate:       (avgOpenRate  * 100).toFixed(1),
        avgClickRate:      (avgClickRate * 100).toFixed(1),

        // Dernières campagnes pour le graphique
        campaigns: campaigns.map(c => ({
          title:     c.settings?.subject_line || c.settings?.title || "Sans titre",
          sendTime:  c.send_time,
          openRate:  ((c.report_summary?.open_rate  || 0) * 100).toFixed(1),
          clickRate: ((c.report_summary?.click_rate || 0) * 100).toFixed(1),
          sends:     c.emails_sent || 0,
        })),

        // Historique de croissance
        growth: growth.map(g => ({
          month:       g.month,
          subscribed:  g.subscribed   || 0,
          unsubscribed:g.unsubscribed || 0,
        })),
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Erreur lors de l'appel à Mailchimp : " + err.message }),
    };
  }
};
