"""
🔍 HERRAMIENTA WEB UNIFICADA - Búsqueda con Visualización en Tiempo Real
Combina capacidades de búsqueda efectiva con visualización progresiva paso a paso

IMPLEMENTA: WEBUPGRADE.md Fase 2 - Unified Web Search Tool
- Elimina duplicaciones (web_search + playwright_web_search)
- Integra WebBrowserManager para screenshots en tiempo real  
- Emite eventos WebSocket progresivos para terminal
- Nombre único "web_search" que coincide con planes generados
"""

import asyncio
import time
import os
from typing import Dict, List, Any
from datetime import datetime
from urllib.parse import urljoin

from .base_tool import BaseTool, ParameterDefinition, ToolExecutionResult, register_tool

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

# Importar WebBrowserManager para visualización en tiempo real
try:
    from ..web_browser_manager import WebBrowserManager
    BROWSER_MANAGER_AVAILABLE = True
except ImportError:
    BROWSER_MANAGER_AVAILABLE = False

# Importar WebSocket manager para eventos en tiempo real
try:
    from ..websocket.websocket_manager import get_websocket_manager
    WEBSOCKET_AVAILABLE = True
except ImportError:
    WEBSOCKET_AVAILABLE = False

@register_tool
class UnifiedWebSearchTool(BaseTool):
    """
    🔍 HERRAMIENTA WEB UNIFICADA CON VISUALIZACIÓN EN TIEMPO REAL
    
    Características:
    - ✅ Búsqueda web potente usando Playwright
    - ✅ Screenshots automáticos en cada paso
    - ✅ Eventos WebSocket progresivos  
    - ✅ Visualización terminal en tiempo real
    - ✅ Nombre único "web_search" (coincide con planes)
    """
    
    def __init__(self):
        super().__init__(
            name="web_search",  # 🔥 NOMBRE ÚNICO - coincide con planes generados
            description="Búsqueda web unificada con visualización en tiempo real - Screenshots paso a paso en terminal"
        )
        self.playwright_available = PLAYWRIGHT_AVAILABLE
        self.browser_manager = None
        self.websocket_manager = None
        self.task_id = None
        
    def _define_parameters(self) -> List[ParameterDefinition]:
        return [
            ParameterDefinition(
                name="query",
                param_type="string",
                required=True,
                description="Consulta de búsqueda",
                min_value=1,
                max_value=500
            ),
            ParameterDefinition(
                name="max_results",
                param_type="integer",
                required=False,
                description="Número máximo de resultados",
                default=8,
                min_value=1,
                max_value=15
            ),
            ParameterDefinition(
                name="search_engine",
                param_type="string",
                required=False,
                description="Motor de búsqueda (bing recomendado)",
                default="bing",
                choices=["bing", "google"]
            ),
            ParameterDefinition(
                name="extract_content",
                param_type="boolean",
                required=False,
                description="Extraer contenido de las primeras páginas",
                default=True
            )
        ]
    
    def _execute_tool(self, parameters: Dict[str, Any], config: Dict[str, Any] = None) -> ToolExecutionResult:
        """🚀 EJECUTOR PRINCIPAL CON VISUALIZACIÓN EN TIEMPO REAL"""
        
        if not self.playwright_available:
            return ToolExecutionResult(
                success=False,
                error='Playwright no está disponible. Instalar con: pip install playwright'
            )
        
        # Extraer parámetros
        query = parameters.get('query', '').strip()
        max_results = parameters.get('max_results', 8)
        search_engine = parameters.get('search_engine', 'bing')
        extract_content = parameters.get('extract_content', True)
        
        # Obtener task_id del config si está disponible
        self.task_id = config.get('task_id') if config else None
        
        # DEBUG: Escribir directamente a archivo para verificar task_id
        try:
            with open('/tmp/websocket_debug.log', 'a') as f:
                f.write(f"[{datetime.now()}] WEB SEARCH CONFIG: task_id={self.task_id}, config={config}\n")
                f.flush()
        except:
            pass
        
        # FORZAR EMISIÓN DE WEBSOCKET INCLUSO SIN TASK_ID (para debugging)
        if not self.task_id:
            # Si no hay task_id, usar un ID de fallback para testing
            self.task_id = "debug-websocket-test"
            try:
                with open('/tmp/websocket_debug.log', 'a') as f:
                    f.write(f"[{datetime.now()}] USING FALLBACK TASK_ID: {self.task_id}\n")
                    f.flush()
            except:
                pass
        
        try:
            # 🔄 INICIALIZAR VISUALIZACIÓN EN TIEMPO REAL
            if not self._initialize_real_time_components():
                # Si falla la inicialización, continuar sin visualización
                pass
            
            # 🔍 EJECUTAR BÚSQUEDA CON VISUALIZACIÓN PASO A PASO
            results = self._execute_search_with_visualization(
                query, search_engine, max_results, extract_content
            )
            
            # ✅ RESULTADO EXITOSO
            return ToolExecutionResult(
                success=True,
                data={
                    'query': query,
                    'search_engine': search_engine,
                    'results_count': len(results),
                    'results': results,
                    'search_results': results,  # Para compatibilidad
                    'extract_content': extract_content,
                    'visualization_enabled': self.browser_manager is not None,
                    'screenshots_generated': any(r.get('screenshot_url') for r in results),
                    'timestamp': datetime.now().isoformat()
                }
            )
            
        except Exception as e:
            # 📧 NOTIFICAR ERROR EN TIEMPO REAL
            self._emit_progress(f"❌ Error en búsqueda: {str(e)}")
            
            return ToolExecutionResult(
                success=False,
                error=f'Error en búsqueda unificada: {str(e)}'
            )
        finally:
            # 🧹 LIMPIAR RECURSOS
            self._cleanup_browser_manager()
    
    def _initialize_real_time_components(self) -> bool:
        """🔧 INICIALIZAR COMPONENTES PARA VISUALIZACIÓN EN TIEMPO REAL"""
        try:
            # Inicializar WebSocket manager
            if WEBSOCKET_AVAILABLE and self.task_id:
                self.websocket_manager = get_websocket_manager()
                
            # Inicializar Browser manager para screenshots
            if BROWSER_MANAGER_AVAILABLE and self.task_id:
                self.browser_manager = WebBrowserManager(
                    task_id=self.task_id,
                    websocket_manager=self.websocket_manager
                )
                
                # Inicializar navegador
                browser_ready = self.browser_manager.initialize_browser()
                if browser_ready:
                    self._emit_progress("🚀 Navegador inicializado para visualización en tiempo real")
                    return True
                else:
                    self._emit_progress("⚠️ Navegador no disponible - continuando sin visualización")
                    self.browser_manager = None
                    
            return False
            
        except Exception as e:
            self._emit_progress(f"⚠️ Error inicializando visualización: {str(e)}")
            self.browser_manager = None
            self.websocket_manager = None
            return False
    
    def _execute_search_with_visualization(self, query: str, search_engine: str, 
                                         max_results: int, extract_content: bool) -> List[Dict[str, Any]]:
        """
        🔍 BÚSQUEDA CON VISUALIZACIÓN PASO A PASO
        Implementa el flujo especificado en WEBUPGRADE.md Sección 2.2
        """
        
        # PASO 1: INICIALIZACIÓN
        self._emit_progress(f"🔍 Iniciando búsqueda web: '{query}'")
        self._emit_progress(f"🌐 Motor de búsqueda: {search_engine}")
        
        try:
            # Ejecutar búsqueda con Playwright usando método compatible con eventlet
            results = self._run_async_search_with_visualization(
                query, search_engine, max_results, extract_content
            )
            
            # PASO FINAL: RESUMEN
            self._emit_progress(f"✅ Búsqueda completada: {len(results)} resultados encontrados")
            
            return results
            
        except Exception as e:
            self._emit_progress(f"❌ Error durante búsqueda: {str(e)}")
            raise
    
    def _run_async_search_with_visualization(self, query: str, search_engine: str, 
                                           max_results: int, extract_content: bool) -> List[Dict[str, Any]]:
        """🔄 EJECUTAR BÚSQUEDA ASYNC CON VISUALIZACIÓN"""
        
        import threading
        
        results = []
        exception = None
        
        def run_in_thread():
            nonlocal results, exception
            try:
                # Crear nuevo event loop en hilo separado
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                results = loop.run_until_complete(
                    self._search_with_playwright_and_visualization(
                        query, search_engine, max_results, extract_content
                    )
                )
                
                loop.close()
                
            except Exception as e:
                exception = e
        
        # Ejecutar en hilo separado para evitar conflictos
        thread = threading.Thread(target=run_in_thread)
        thread.start()
        thread.join(timeout=45)  # 45 segundos timeout
        
        if exception:
            raise exception
            
        if thread.is_alive():
            raise Exception("Timeout en búsqueda con visualización")
            
        return results
    
    async def _search_with_playwright_and_visualization(self, query: str, search_engine: str, 
                                                      max_results: int, extract_content: bool) -> List[Dict[str, Any]]:
        """
        🌐 BÚSQUEDA REAL CON PLAYWRIGHT + VISUALIZACIÓN EN TIEMPO REAL
        Combina las mejores características de ambas herramientas originales
        """
        
        # PASO 2: NAVEGACIÓN
        self._emit_progress(f"🌐 Navegando a {search_engine}...")
        
        # Construir URL de búsqueda
        search_url = self._build_search_url(query, search_engine)
        
        results = []
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=['--no-sandbox', '--disable-dev-shm-usage']
            )
            
            try:
                # Crear contexto con user agent real
                context = await browser.new_context(
                    viewport={'width': 1920, 'height': 800},  # Optimizado para screenshots
                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                )
                
                page = await context.new_page()
                page.set_default_timeout(30000)
                
                # NAVEGACIÓN CON SCREENSHOT
                await page.goto(search_url, wait_until='networkidle')
                await page.wait_for_timeout(2000)  # Esperar carga completa
                
                # 📸 SCREENSHOT DE PÁGINA DE BÚSQUEDA
                screenshot_url = await self._take_screenshot(page, f"search_page_{search_engine}")
                self._emit_progress(f"📸 Página de búsqueda cargada")
                self._send_screenshot(screenshot_url, f"Búsqueda en {search_engine}: {query}")
                
                # PASO 3: EXTRACCIÓN DE RESULTADOS
                self._emit_progress(f"📊 Extrayendo resultados de búsqueda...")
                
                # Extraer resultados según motor de búsqueda
                if search_engine == 'bing':
                    results = await self._extract_bing_results(page, max_results)
                elif search_engine == 'google':
                    results = await self._extract_google_results(page, max_results)
                else:
                    results = await self._extract_bing_results(page, max_results)  # Default
                
                self._emit_progress(f"🔗 Encontrados {len(results)} resultados")
                
                # 📸 SCREENSHOT DE RESULTADOS
                screenshot_url = await self._take_screenshot(page, "search_results")
                self._send_screenshot(screenshot_url, f"Resultados encontrados: {len(results)}")
                
                # PASO 4: EXTRACCIÓN DE CONTENIDO (SI SE SOLICITA)
                if extract_content and results:
                    await self._extract_content_with_visualization(context, results, min(3, len(results)))
                
            finally:
                await browser.close()
        
        return results
    
    async def _extract_content_with_visualization(self, context, results: List[Dict], max_extract: int):
        """📄 EXTRAER CONTENIDO CON VISUALIZACIÓN PROGRESIVA"""
        
        self._emit_progress(f"📄 Extrayendo contenido de {max_extract} primeros resultados...")
        
        for i, result in enumerate(results[:max_extract]):
            try:
                self._emit_progress(f"🔗 Procesando resultado {i+1}/{max_extract}: {result['title'][:50]}...")
                
                # Crear nueva página para contenido
                page = await context.new_page()
                await page.goto(result['url'], wait_until='domcontentloaded', timeout=15000)
                await page.wait_for_timeout(1000)
                
                # 📸 SCREENSHOT DE CONTENIDO
                screenshot_url = await self._take_screenshot(page, f"content_{i+1}")
                result['screenshot_url'] = screenshot_url
                
                # Extraer contenido principal
                content = await self._extract_page_content_playwright(page)
                result['content'] = content
                result['content_extracted'] = True
                
                self._emit_progress(f"   ✅ Contenido extraído: {len(content)} caracteres")
                self._send_screenshot(screenshot_url, f"Contenido: {result['title'][:40]}")
                
                await page.close()
                
            except Exception as e:
                self._emit_progress(f"   ⚠️ Error extrayendo contenido: {str(e)}")
                result['content'] = ''
                result['content_extracted'] = False
    
    async def _extract_bing_results(self, page, max_results: int) -> List[Dict[str, Any]]:
        """🔍 EXTRAER RESULTADOS DE BING (Método mejorado)"""
        results = []
        
        result_elements = await page.query_selector_all('li.b_algo')
        
        for element in result_elements[:max_results]:
            try:
                # Título
                title_element = await element.query_selector('h2')
                title = await title_element.text_content() if title_element else ''
                
                # URL
                link_element = await element.query_selector('h2 a')
                url = await link_element.get_attribute('href') if link_element else ''
                
                # Snippet
                snippet_element = await element.query_selector('.b_caption')
                snippet = await snippet_element.text_content() if snippet_element else ''
                
                if title and url and url.startswith('http'):
                    results.append({
                        'title': title.strip(),
                        'url': url.strip(),
                        'snippet': snippet.strip(),
                        'source': 'bing'
                    })
                    
            except Exception:
                continue
        
        return results
    
    async def _extract_google_results(self, page, max_results: int) -> List[Dict[str, Any]]:
        """🔍 EXTRAER RESULTADOS DE GOOGLE (Método mejorado)"""
        results = []
        
        result_elements = await page.query_selector_all('div.g, div[data-ved]')
        
        for element in result_elements[:max_results]:
            try:
                # Título
                title_element = await element.query_selector('h3')
                title = await title_element.text_content() if title_element else ''
                
                # URL
                link_element = await element.query_selector('a')
                url = await link_element.get_attribute('href') if link_element else ''
                
                # Snippet
                snippet_element = await element.query_selector('.VwiC3b, .s3v9rd, .st')
                snippet = await snippet_element.text_content() if snippet_element else ''
                
                if title and url and url.startswith('http'):
                    results.append({
                        'title': title.strip(),
                        'url': url.strip(),
                        'snippet': snippet.strip(),
                        'source': 'google'
                    })
                    
            except Exception:
                continue
        
        return results
    
    async def _extract_page_content_playwright(self, page) -> str:
        """📄 EXTRAER CONTENIDO DE PÁGINA (Método optimizado)"""
        try:
            content = await page.evaluate('''
                () => {
                    // Remover elementos innecesarios
                    const unwanted = ['script', 'style', 'nav', 'header', 'footer', 'aside', '.ad'];
                    unwanted.forEach(selector => {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => el.remove());
                    });
                    
                    // Buscar contenido principal
                    const mainSelectors = ['main', 'article', '.content', '.post-content', '#content'];
                    
                    for (let selector of mainSelectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                            return element.innerText.trim();
                        }
                    }
                    
                    return document.body.innerText.trim();
                }
            ''')
            
            # Limpiar y limitar contenido
            if content:
                lines = [line.strip() for line in content.split('\n') if line.strip()]
                clean_content = '\n'.join(lines)
                return clean_content[:3000] + '...' if len(clean_content) > 3000 else clean_content
            
            return ''
            
        except Exception:
            return ''
    
    def _build_search_url(self, query: str, search_engine: str) -> str:
        """🔗 CONSTRUIR URL DE BÚSQUEDA"""
        import urllib.parse
        encoded_query = urllib.parse.quote_plus(query)
        
        if search_engine == 'google':
            return f"https://www.google.com/search?q={encoded_query}"
        elif search_engine == 'bing':
            return f"https://www.bing.com/search?q={encoded_query}&count=20"
        else:
            return f"https://www.bing.com/search?q={encoded_query}&count=20"  # Default
    
    async def _take_screenshot(self, page, filename_prefix: str) -> str:
        """📸 TOMAR SCREENSHOT CON GESTIÓN DE ARCHIVOS"""
        try:
            if not self.task_id:
                return ""
            
            # Crear directorio para screenshots
            screenshot_dir = f"/tmp/screenshots/{self.task_id}"
            os.makedirs(screenshot_dir, exist_ok=True)
            
            # Generar nombre único
            timestamp = int(time.time() * 1000)
            screenshot_name = f"{filename_prefix}_{timestamp}.png"
            screenshot_path = os.path.join(screenshot_dir, screenshot_name)
            
            # Tomar screenshot optimizado
            await page.screenshot(path=screenshot_path, quality=20, full_page=False)
            
            # Retornar URL accesible desde frontend
            return f"/api/files/screenshots/{self.task_id}/{screenshot_name}"
            
        except Exception:
            return ""
    
    def _emit_progress(self, message: str):
        """📡 EMITIR PROGRESO EN TIEMPO REAL VIA WEBSOCKET - CORREGIDO PARA VISUALIZACIÓN EN TERMINAL"""
        try:
            if self.task_id:
                import logging
                from datetime import datetime
                
                # SOLUCIÓN CORRECTA: Usar websocket_manager global
                from ..websocket.websocket_manager import get_websocket_manager
                
                logger = logging.getLogger(__name__)
                logger.info(f"🔍 WEB SEARCH PROGRESS: {message} for task {self.task_id}")
                
                # Obtener websocket manager global
                websocket_manager = get_websocket_manager()
                
                if websocket_manager and websocket_manager.is_initialized:
                    # 🔥 FIX CRÍTICO: Enviar como log_message para que aparezca en terminal
                    websocket_manager.send_log_message(self.task_id, "info", message)
                    
                    # También enviar como browser activity si es navegación
                    if any(keyword in message.lower() for keyword in ['navegando', 'página', 'screenshot', 'navegador']):
                        websocket_manager.send_browser_activity(
                            self.task_id, 
                            "navigation_progress", 
                            "https://web-search", 
                            message, 
                            ""
                        )
                    
                    logger.info(f"📡 WEB SEARCH PROGRESS EMITTED TO TERMINAL: {message[:50]}... to task {self.task_id}")
                else:
                    logger.warning(f"⚠️ Global WebSocket manager not available or initialized for task {self.task_id}")
                    # Fallback: escribir a archivo para debug
                    try:
                        with open('/tmp/websocket_debug.log', 'a') as f:
                            f.write(f"[{datetime.now()}] WEBSOCKET MANAGER NOT AVAILABLE: {message}\n")
                            f.flush()
                    except:
                        pass
                
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"❌ Error emitting web search progress via global manager: {e}")
            import traceback
            traceback.print_exc()
    
    def _send_screenshot(self, screenshot_url: str, description: str):
        """📸 ENVIAR SCREENSHOT VIA WEBSOCKET - CORREGIDO PARA VISUALIZACIÓN EN TERMINAL"""
        try:
            if self.task_id and screenshot_url:
                from ..websocket.websocket_manager import get_websocket_manager
                import logging
                
                logger = logging.getLogger(__name__)
                websocket_manager = get_websocket_manager()
                
                if websocket_manager and websocket_manager.is_initialized:
                    # Enviar browser activity con screenshot
                    websocket_manager.send_browser_activity(
                        self.task_id,
                        "screenshot_captured",
                        screenshot_url,  # URL como "URL"
                        description,     # descripción como "title"
                        screenshot_url   # screenshot_url para la imagen
                    )
                    
                    logger.info(f"📸 SCREENSHOT SENT TO TERMINAL: {description} - {screenshot_url}")
                else:
                    logger.warning(f"⚠️ WebSocket manager not available for screenshot: {screenshot_url}")
                    
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"❌ Error sending screenshot via WebSocket: {e}")
    
    def _cleanup_browser_manager(self):
        """🧹 LIMPIAR RECURSOS DEL NAVEGADOR"""
        try:
            if self.browser_manager:
                self.browser_manager.close_browser()
                self.browser_manager = None
        except Exception:
            pass
    
    def get_tool_info(self) -> Dict[str, Any]:
        """ℹ️ INFORMACIÓN DE LA HERRAMIENTA UNIFICADA"""
        return {
            'category': 'web_search_unified',
            'version': '2.0.0',
            'unified_from': ['web_search_tool', 'playwright_web_search_tool'],
            'features': [
                'Búsqueda web potente con Playwright',
                'Screenshots automáticos paso a paso',
                'Visualización en tiempo real en terminal',
                'Eventos WebSocket progresivos',
                'Extracción de contenido inteligente',
                'Soporte múltiples motores de búsqueda'
            ],
            'real_time_visualization': True,
            'websocket_events': True,
            'screenshot_support': True,
            'playwright_required': True,
            'playwright_available': self.playwright_available
        }