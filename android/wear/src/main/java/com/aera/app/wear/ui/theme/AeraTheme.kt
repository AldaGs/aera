package com.aera.app.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Typography

/** Nocturne design tokens (see docs/design_handoff_aera_record_watch/README.md). */
object Nocturne {
    val bg = Color(0xFF161826)
    val surface = Color(0xFF232532)
    val text = Color(0xFFE9E9ED)
    val accent = Color(0xFF9184D9)

    // Accent ramp 100->900
    val accent100 = Color(0xFFF5F4FF)
    val accent200 = Color(0xFFE7E5FE)
    val accent300 = Color(0xFFD2CEFD)
    val accent400 = Color(0xFFB5ABFC)
    val accent500 = Color(0xFF968AE0)
    val accent600 = Color(0xFF796CBF)
    val accent800 = Color(0xFF423A6A)
    val accent900 = Color(0xFF2B2741)

    // Neutral ramp 100->900
    val neutral400 = Color(0xFFB2B6CA)
    val neutral500 = Color(0xFF75798C)
    val neutral600 = Color(0xFF595D6C)
    val neutral700 = Color(0xFF3F424D)
    val neutral800 = Color(0xFF292B31)

    /** Watch OLED ground: color-mix(in oklch, bg 50%, black) approximation. */
    val ground = Color(0xFF0B0C14)

    /** HR zone colors Z1..Z5. */
    val zoneColors = listOf(neutral700, accent800, accent600, accent400, accent200)

    /** Zone-guard "above target" tint — desaturated amber, matches --color-attention
     * on the phone (src/styles.css). */
    val attention = Color(0xFFC9A26B)
}

private val wearColors = Colors(
    primary = Nocturne.accent500,
    primaryVariant = Nocturne.accent600,
    secondary = Nocturne.accent300,
    secondaryVariant = Nocturne.accent400,
    background = Nocturne.ground,
    surface = Nocturne.surface,
    error = Color(0xFFE7E5FE),
    onPrimary = Nocturne.ground,
    onSecondary = Nocturne.ground,
    onBackground = Nocturne.text,
    onSurface = Nocturne.text,
    onError = Nocturne.ground,
)

// System sans (Roboto on Wear OS) at 400/500 with tabular numerals for metrics.
private val wearTypography = Typography(
    display1 = TextStyle(fontWeight = FontWeight.Normal, fontFeatureSettings = "tnum"),
    title1 = TextStyle(fontWeight = FontWeight.Medium),
    title2 = TextStyle(fontWeight = FontWeight.Medium),
    title3 = TextStyle(fontWeight = FontWeight.Medium),
    body1 = TextStyle(fontWeight = FontWeight.Normal),
    body2 = TextStyle(fontWeight = FontWeight.Normal),
    caption1 = TextStyle(fontWeight = FontWeight.Normal),
    caption2 = TextStyle(fontWeight = FontWeight.Normal),
)

@Composable
fun AeraTheme(content: @Composable () -> Unit) {
    MaterialTheme(colors = wearColors, typography = wearTypography, content = content)
}
