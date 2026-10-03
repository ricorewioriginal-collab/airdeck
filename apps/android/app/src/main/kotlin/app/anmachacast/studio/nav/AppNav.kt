package app.anmachacast.studio.nav

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Podcasts
import androidx.compose.material.icons.filled.SettingsInputAntenna
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import app.anmachacast.studio.common.PlaceholderScreen
import app.anmachacast.studio.connect.ConnectScreen
import app.anmachacast.studio.connect.ConnectionStatusViewModel
import app.anmachacast.studio.golive.GoLiveScreen
import app.anmachacast.studio.home.HomeScreen
import app.anmachacast.studio.more.MoreScreen
import app.anmachacast.studio.studio.StudioScreen
import androidx.lifecycle.viewmodel.compose.viewModel

private object Routes {
    const val CONNECT = "connect"
    const val HOME = "home"
    const val STUDIO = "studio"
    const val GOLIVE = "golive"
    const val MORE = "more"
    const val PLACEHOLDER = "placeholder/{title}"
}

private data class BottomDest(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val bottomDestinations = listOf(
    BottomDest(Routes.HOME, "Home", Icons.Filled.Home),
    BottomDest(Routes.STUDIO, "Studio", Icons.Filled.SettingsInputAntenna),
    BottomDest(Routes.GOLIVE, "Go Live", Icons.Filled.Podcasts),
    BottomDest(Routes.MORE, "Mehr", Icons.Filled.MoreHoriz),
)

@Composable
fun AppNav(startConnected: Boolean) {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showBottomBar = bottomDestinations.any { it.route == currentRoute }

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar {
                    bottomDestinations.forEach { dest ->
                        NavigationBarItem(
                            selected = currentRoute == dest.route,
                            onClick = {
                                navController.navigate(dest.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(dest.icon, contentDescription = dest.label) },
                            label = { Text(dest.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = if (startConnected) Routes.HOME else Routes.CONNECT,
            modifier = androidx.compose.ui.Modifier.padding(padding),
        ) {
            composable(Routes.CONNECT) {
                ConnectScreen(onConnected = {
                    navController.navigate(Routes.HOME) { popUpTo(Routes.CONNECT) { inclusive = true } }
                })
            }
            composable(Routes.HOME) {
                val statusViewModel: ConnectionStatusViewModel = viewModel()
                HomeScreen(
                    onOpenStudio = { navController.navigate(Routes.STUDIO) },
                    onOpenGoLive = { navController.navigate(Routes.GOLIVE) },
                    onDisconnect = {
                        statusViewModel.disconnect()
                        navController.navigate(Routes.CONNECT) { popUpTo(0) { inclusive = true } }
                    },
                )
            }
            composable(Routes.STUDIO) { StudioScreen() }
            composable(Routes.GOLIVE) { GoLiveScreen() }
            composable(Routes.MORE) {
                MoreScreen(onOpenPlaceholder = { title -> navController.navigate("placeholder/$title") })
            }
            composable(
                Routes.PLACEHOLDER,
                arguments = listOf(navArgument("title") { type = NavType.StringType }),
            ) { backStack ->
                PlaceholderScreen(title = backStack.arguments?.getString("title") ?: "")
            }
        }
    }
}
