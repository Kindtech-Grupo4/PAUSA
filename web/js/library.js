// Catálogos compartidos de la interfaz y respaldo local cuando el motor Python no responde.
export const TRIGGERS = {
  aburrimiento: 'Aburrimiento', estres: 'Estrés', ansiedad: 'Ansiedad', antes_de_dormir: 'Antes de dormir',
  habito: 'Hábito', soledad: 'Soledad', curiosidad: 'Curiosidad', otro: 'Otro',
};

export const LIBRARY = {
  breath: { title: 'Respiración bio-interactiva', icon: '◎', desc: 'Exhala hacia el micrófono (o mantén pulsado) y la luz responde a tu ritmo.', minutes: 3, sensor: 'micrófono o táctil' },
  tense: { title: 'Micro-pausa de 10 segundos', icon: '✊', desc: 'Tensa los puños mientras mantienes pulsado, suelta y siente el cuerpo.', minutes: 0.2, sensor: 'táctil' },
  motion: { title: 'Reconexión corporal', icon: '〰', desc: '60 segundos de movimiento guiado medido como movimiento abstracto.', minutes: 1, sensor: 'cámara (opcional)' },
  sleep: { title: 'Rutina para dormir 4-7-8', icon: '☾', desc: 'Respiración lenta con la pantalla atenuándose hasta apagarse.', minutes: 4, sensor: 'micrófono o táctil' },
  reach: { title: 'Escribirle a alguien de confianza', icon: '✉', desc: 'Una frase para empezar la conversación. Nadie sabrá por qué escribiste.', minutes: 5, sensor: null },
  walk: { title: 'Cambiar de espacio', icon: '↗', desc: 'Levántate, toma agua o camina. Te avisamos con un sonido suave.', minutes: 5, sensor: null },
};

const CRISIS = {
  autolesion: ['suicid', 'matarme', 'quitarme la vida', 'no quiero vivir', 'hacerme dano', 'cortarme', 'lastimarme', 'acabar con todo', 'quiero morir', 'mejor muert'],
  desesperanza: ['ya no puedo mas', 'no vale la pena vivir', 'sin salida', 'nada tiene sentido', 'no tengo salida'],
  violencia: ['me pega', 'me golpea', 'me obliga', 'abus', 'violac', 'me amenaza', 'chantaje', 'sextorsion', 'difundir mis fotos', 'me extorsiona'],
  menores: ['menor de edad', 'tengo 13', 'tengo 14', 'tengo 15', 'tengo 16', 'tengo 17', 'contenido de menores'],
};
const SENSITIVE = ['porn', 'xxx', 'onlyfans', 'desnud', 'masturb', 'nude', 'hentai', 'xvideos'];
const LEX = {
  estres: ['estres', 'examen', 'parcial', 'entrega', 'tesis', 'presion', 'saturad', 'procrastin', 'tarea'],
  ansiedad: ['ansie', 'nervio', 'inquiet', 'preocup', 'angust', 'panico', 'intranquil'],
  aburrimiento: ['aburr', 'nada que hacer', 'sin hacer nada', 'matar el tiempo', 'scroll'],
  antes_de_dormir: ['dormir', 'insomnio', 'cama', 'no tengo sueno', 'madrugada', 'desvel', 'sin sueno'],
  habito: ['costumbre', 'automatic', 'sin pensar', 'rutina', 'inercia'],
  soledad: ['soledad', 'solo', 'sola', 'nadie', 'aislad', 'extran', 'ruptura'],
  curiosidad: ['curios', 'explorar', 'probar'],
};
const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');

export const fallback = {
  analyze(note, ai = false) {
    const n = norm(note);
    const crisis = Object.keys(CRISIS).find((c) => CRISIS[c].some((t) => n.includes(t))) || null;
    const sensitive = SENSITIVE.some((t) => n.includes(t));
    let label = null;
    if (ai && !crisis) {
      const hits = Object.entries(LEX).map(([k, ws]) => [k, ws.filter((w) => n.includes(w))]).filter(([, w]) => w.length);
      hits.sort((a, b) => b[1].length - a[1].length);
      if (hits.length) {
        const [best, ev] = hits[0];
        label = { id: best, label: TRIGGERS[best], confidence: 0.7, evidence: ev.slice(0, 2), alternatives: hits.slice(1, 3).map(([k]) => k) };
      }
    }
    return {
      crisis, label,
      reason: label ? `Sugerida porque tu nota incluye ${label.evidence.map((w) => `“${w}”`).join(', ')}. Puedes cambiarla o ignorarla.` : null,
      uncertain: !label,
      store_note: !sensitive && !crisis,
      sanitized_note: sensitive ? '' : (note || '').replace(/(https?:\/\/\S+|www\.\S+)/gi, '[enlace omitido]'),
      privacy_notice: sensitive ? 'Por tu privacidad no guardamos detalles explícitos: basta con la etiqueta.' : null,
    };
  },
  recommend({ hour, trigger = 'otro' }, ai = false) {
    const night = hour >= 22 || hour < 5;
    const order = night ? ['sleep', 'breath', 'tense'] : trigger === 'soledad' ? ['reach', 'walk', 'breath'] : ['breath', 'tense', 'walk'];
    return order.map((id) => ({
      id, ...LIBRARY[id],
      why: ai ? `Recomendada para «${TRIGGERS[trigger] || 'tu momento'}» según la hora.` : 'Orden fijo de la biblioteca (sin asistente IA).',
      phrase: id === 'reach' ? 'Hola, ¿cómo estás? Hace tiempo que no hablamos.' : undefined,
    }));
  },
  patterns(records, ai = false) {
    const franjas = { madrugada: 0, mañana: 0, tarde: 0, noche: 0 };
    const trig = {};
    records.forEach((r) => {
      const h = r.hour; const f = h <= 5 ? 'madrugada' : h <= 11 ? 'mañana' : h <= 17 ? 'tarde' : 'noche';
      franjas[f] += 1; const t = r.trigger || 'otro'; trig[t] = (trig[t] || 0) + 1;
    });
    if (!ai) {
      return { enough: false, rulesOnly: true, n: records.length, counts: { franja: franjas, trigger: trig },
        insights: ['Modo sin asistente: solo se muestran conteos de tu registro, sin interpretación.'] };
    }
    if (records.length < 7) {
      return { enough: false, n: records.length, counts: { franja: franjas, trigger: trig },
        insights: [`Aún no hay patrones: llevas ${records.length} de 7 registros. Seguir registrando sin presión ayuda a que la lectura sea honesta.`] };
    }
    const topF = Object.entries(franjas).sort((a, b) => b[1] - a[1])[0];
    const topT = Object.entries(trig).sort((a, b) => b[1] - a[1])[0];
    return {
      enough: true, n: records.length, counts: { franja: franjas, trigger: trig },
      insights: [
        `Parece que el impulso aparece con más frecuencia en la ${topF[0]} (${Math.round((topF[1] * 100) / records.length)}% de tus registros).`,
        `Parece que «${TRIGGERS[topT[0]] || topT[0]}» es lo que más acompaña al impulso (${topT[1]} de ${records.length} veces).`,
      ],
      autonomy: records.length >= 10 ? 'Ya reconoces tus principales horarios y detonantes. El éxito de PAUSA es tu autonomía: si sientes que ya identificas el impulso a tiempo, puedes necesitar abrirla cada vez menos.' : null,
      disclaimer: 'Son correlaciones, no causas. Puede equivocarse y no es un diagnóstico.',
    };
  },
};
