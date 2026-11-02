// Abrir projeto: uma cortina com o nome dele sobe, cobre a tela e, já na página nova, segue subindo
// e revela o hero. O X faz o inverso, descendo até a home, sem repetir o loader. O movimento é todo
// em CSS (global.css); aqui só entram as classes e o tempo. Roda antes do primeiro desenho, para a
// página nova já nascer coberta.
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var COVER = 500; // Duração da subida da cortina, igual ao CSS.
  var HERO_LIMIT = 450; // ms: rede lenta não pode prender a cortina na tela.
  var HOME = 'Home';
  var PROJECTS = ['tex', 'babel', 'dare', 'goldcare', 'playground']; // Lista da home, "Next project" e qualquer outro link para um case.
  var root = document.documentElement;

  // Só durante a entrada: depois o texto volta a ser uma palavra, com o kerning da fonte.
  var splitTitle = function () {
    document.querySelectorAll('#hero h1').forEach(function (title) {
      var text = title.textContent;
      title.textContent = '';
      title.setAttribute('aria-label', text);
      text.split('').forEach(function (letter, i) {
        var span = document.createElement('span');
        span.textContent = letter === ' ' ? ' ' : letter;
        span.style.setProperty('--i', i);
        span.setAttribute('aria-hidden', 'true');
        title.append(span);
      });
      setTimeout(function () {
        title.textContent = text;
        title.removeAttribute('aria-label');
      }, 2600);
    });
  };

  var heroReady = function () {
    // Só as imagens desenhadas: as das outras larguras nunca carregam e prenderiam a cortina.
    var images = [].slice
      .call(document.querySelectorAll('#hero img'))
      .filter(function (img) {
        return img.getClientRects().length;
      })
      .map(function (img) {
        return img.decode().catch(function () {});
      });
    return Promise.race([
      Promise.all(images),
      new Promise(function (done) {
        setTimeout(done, HERO_LIMIT);
      }),
    ]);
  };

  var opening = sessionStorage.getItem('opening');
  if (opening) {
    var back = opening === 'back';
    sessionStorage.removeItem('opening');
    root.dataset.curtain = back ? HOME : document.title.split(' | ')[0];
    root.classList.add('lifting', 'waiting', 'arrived');
    root.classList.toggle('back', back);
    document.addEventListener('DOMContentLoaded', function () {
      if (!back) splitTitle();
      heroReady().then(function () {
        root.classList.remove('waiting');
      });
    });
  }

  addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a') : null;
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var back = link.getAttribute('aria-label') === 'Back to home';
    var name = link.pathname.replace(/\//g, '');
    if (!back && (link.origin !== location.origin || PROJECTS.indexOf(name) < 0)) return;
    e.preventDefault();
    if (root.classList.contains('closing')) return;
    root.dataset.curtain = back ? HOME : name.charAt(0).toUpperCase() + name.slice(1);
    // A cortina da chegada já terminou: se ficar, ela vence a de saída e mostra a mesma tela.
    root.classList.remove('lifting', 'waiting');
    root.classList.add('closing');
    root.classList.toggle('back', back);
    sessionStorage.setItem('opening', back ? 'back' : '1');
    setTimeout(function () {
      location.assign(link.href);
    }, COVER);
  });

  // Voltar pelo navegador devolve a página como ela estava, ainda coberta.
  addEventListener('pageshow', function (e) {
    if (e.persisted) root.classList.remove('closing', 'back');
  });
})();
