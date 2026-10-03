package app.anmachacast.studio.nav

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.anmachacast.studio.AnMaChaCastApp
import app.anmachacast.studio.common.PlaceholderScreen
import app.anmachacast.studio.connect.ConnectScreen
import app.anmachacast.studio.connect.ConnectionStatusViewModel
import app.anmachacast.studio.golive.GoLiveViewModel
import app.anmachacast.studio.golive.LiveScreen
import app.anmachacast.studio.golive.MusicScreen
import app.anmachacast.studio.golive.LautFmLoginScreen
import app.anmachacast.studio.golive.SetupScreen
import app.anmachacast.studio.home.HomeScreen
import app.anmachacast.studio.more.MoreScreen
import app.anmachacast.studio.radioadmin.RaManageScreen
import app.anmachacast.studio.radioadmin.RaOverviewScreen
import app.anmachacast.studio.radioadmin.RaProgramScreen
import app.anmachacast.studio.radioadmin.RaScheduleScreen
import app.anmachacast.studio.radioadmin.RaStatsScreen
import app.anmachacast.studio.radioadmin.RadioadminViewModel
import app.anmachacast.studio.start.StartScreen
import app.anmachacast.studio.studio.StudioScreen

private object Routes {
    const val START = "start"
    const val LIVE = "live"
    const val MUSIC = "music"
    const val SETUP = "setup"
    const val LAUTLOGIN = "lautlogin"
    const val RA_OVERVIEW = "ra_overview"
    const val RA_PROGRAM = "ra_program"
    const val RA_SCHEDULE = "ra_schedule"
    const val RA_STATS = "ra_stats"
    const val RA_MANAGE = "ra_manage"
    const val HOME = "home"
    const val STUDIO = "studio"
    const val MORE = "more"
    const val PLACEHOLDER = "placeholder/{title}"
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val liveTabs = listOf(
    Tab(Routes.LIVE, "Live", Icons.Filled.Mic),
    Tab(Routes.MUSIC, "Musik", Icons.Filled.LibraryMusic),
    Tab(Routes.SETUP, "Sender", Icons.Filled.Settings),
)
private val studioTabs = listOf(
    Tab(Routes.HOME, "Server", Icons.Filled.Dns),
    Tab(Routes.STUDIO, "Studio", Icons.Filled.SettingsInputAntenna),
    Tab(Routes.MORE, "Mehr", Icons.Filled.MoreHoriz),
)

private val adminTabs = listOf(
    Tab(Routes.RA_OVERVIEW, "Übersicht", Icons.Filled.Dashboard),
    Tab(Routes.RA_PROGRAM, "Programm", Icons.Filled.LibraryMusic),
    Tab(Routes.RA_SCHEDULE, "Sendeplan", Icons.Filled.CalendarMonth),
    Tab(Routes.RA_STATS, "Statistik", Icons.Filled.BarChart),
    Tab(Routes.RA_MANAGE, "Verwalten", Icons.Filled.Tune),
)

private fun modeOf(route: String?): Mode? = when (route) {
    Routes.LIVE, Routes.MUSIC, Routes.SETUP -> Mode.GOLIVE
    Routes.HOME, Routes.STUDIO, Routes.MORE, Routes.PLACEHOLDER -> Mode.STUDIO
    Routes.RA_OVERVIEW, Routes.RA_PROGRAM, Routes.RA_SCHEDULE, Routes.RA_STATS, Routes.RA_MANAGE -> Mode.RADIOADMIN
    else -> null
}

@Composable
fun AppNav() {
    val context = LocalContext.current
    val app = context.applicationContext as AnMaChaCastApp
    val connection by app.connectionRepository.connection.collectAsState()
    val modeStore = remember { ModeStore(context) }
    var lastMode by remember { mutableStateOf(modeStore.get()) }
    val nav = rememberNavController()
    val live: GoLiveViewModel = viewModel()
    val admin: RadioadminViewModel = viewModel()
    val liveUi by live.ui.collectAsState()
    val route = nav.currentBackStackEntryAsState().value?.destination?.route
    val mode = modeOf(route)
    val connected = connection != null

    // Login-Bildschirm von laut.fm folgt dem Zustand im ViewModel
    val showLogin = liveUi.lautfm.showLogin
    LaunchedEffect(showLogin) {
        if (showLogin && nav.currentDestination?.route != Routes.LAUTLOGIN) nav.navigate(Routes.LAUTLOGIN)
        else if (!showLogin && nav.currentDestination?.route == Routes.LAUTLOGIN) nav.popBackStack()
    }

    fun enter(m: Mode) {
        modeStore.set(m)
        lastMode = m
        nav.navigate(when (m) { Mode.GOLIVE -> Routes.LIVE; Mode.STUDIO -> Routes.HOME; Mode.RADIOADMIN -> Routes.RA_OVERVIEW }) {
            popUpTo(nav.graph.findStartDestination().id) { inclusive = true }
            launchSingleTop = true
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0),
        topBar = { if (mode != null) ModeHeader(mode, liveUi.running) { enter(it) } },
        bottomBar = {
            val tabs = when (mode) {
                Mode.GOLIVE -> liveTabs
                Mode.STUDIO -> if (connected) studioTabs else emptyList()
                Mode.RADIOADMIN -> adminTabs
                null -> emptyList()
            }
            if (tabs.isNotEmpty()) {
                NavigationBar {
                    tabs.forEach { t ->
                        NavigationBarItem(
                            selected = route == t.route,
                            onClick = {
                                nav.navigate(t.route) {
                                    popUpTo(tabs.first().route) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(t.icon, t.label) },
                            label = { Text(t.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        val body = if (mode == null) Modifier.fillMaxSize() else Modifier.padding(padding)
        NavHost(nav, startDestination = Routes.START, modifier = body) {
            composable(Routes.START) {
                StartScreen(last = lastMode, connectedTo = connection?.serverUrl, onPick = ::enter)
            }
            composable(Routes.LIVE) { LiveScreen(live) { nav.navigate(Routes.SETUP) { launchSingleTop = true } } }
            composable(Routes.MUSIC) { MusicScreen(live) }
            composable(Routes.SETUP) { SetupScreen(live) }
            composable(Routes.RA_OVERVIEW) { RaOverviewScreen(admin) { enter(Mode.GOLIVE) } }
            composable(Routes.RA_PROGRAM) { RaProgramScreen(admin) }
            composable(Routes.RA_SCHEDULE) { RaScheduleScreen(admin) }
            composable(Routes.RA_STATS) { RaStatsScreen(admin) }
            composable(Routes.RA_MANAGE) { RaManageScreen(admin) { enter(Mode.GOLIVE) } }
            composable(Routes.LAUTLOGIN) { LautFmLoginScreen(onToken = live::connectLautFm, onClose = live::closeLautFmLogin) }
            composable(Routes.HOME) {
                if (!connected) ConnectScreen(onConnected = {}) else {
                    val status: ConnectionStatusViewModel = viewModel()
                    HomeScreen(
                        onOpenStudio = { nav.navigate(Routes.STUDIO) { launchSingleTop = true } },
                        onDisconnect = status::disconnect,
                    )
                }
            }
            composable(Routes.STUDIO) { if (connected) StudioScreen() else ConnectScreen(onConnected = {}) }
            composable(Routes.MORE) { MoreScreen(onOpenPlaceholder = { nav.navigate("placeholder/$it") }) }
            composable(Routes.PLACEHOLDER, arguments = listOf(navArgument("title") { type = NavType.StringType })) {
                PlaceholderScreen(title = it.arguments?.getString("title") ?: "")
            }
        }
    }
}
