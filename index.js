/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

require('dotenv').config()

// ✅ GLOBAL error output to terminal (debug üçün vacib)
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err)
})
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err)
})

// ✅ Telegraf v4+ (Node 22 exports uyumlu)
const { Telegraf, session } = require('telegraf')

const telegrafStart = require('telegraf-start-parts')
const debug = require('debug')
const stringify = require('json-stringify-safe')
const nl = require('numberlabel')
const { Resources, Translation } = require('nodejs-i18n')
const { CronJob } = require('cron')

const badges = require('./base/badges')
const clan = require('./base/clan')
const classes = require('./base/classes')
const config = require('./base/config')
const database = require('./base/database')
const levels = require('./base/levels')
let quest = require('./base/quest')
const tips = require('./base/tips')
const items = require('./items')
const ia = require('./ia')
const season = require('./base/season')

// ✅ LOG / TELEGRAM REPORTLAR TAM SÖNDÜRÜLÜR
// (config.ids.log, channel, groups, bots nə olursa olsun – heç yerə sendMessage etməyəcək)
const LOGGING_DISABLED = true

const cache = {
  top: {
    wins: [],
    losts: [],
    battles: [],
    money: [],
    level: [],
    online: []
  }
}

// --- BOT INIT ---
if (!process.env.telegram_token) {
  console.error('❌ telegram_token is missing. Please set it in .env')
  process.exit(1)
}

const bot = new Telegraf(process.env.telegram_token, {
  username: 'DefendTheCastleBot'
})

// ✅ Telegram API “chat not found” kimi xətalara görə bot çökməsin
// (hətta haradasa hardcoded id ilə sendMessage olsa belə)
const _callApi = bot.telegram.callApi.bind(bot.telegram)
bot.telegram.callApi = async (method, payload, signal) => {
  try {
    return await _callApi(method, payload, signal)
  } catch (e) {
    const msg = String(e?.description || e?.message || e)

    // Bu xətaları “normal” sayırıq və ignore edirik:
    if (
      msg.includes('chat not found') ||
      msg.includes('bot was blocked by the user') ||
      msg.includes('Forbidden')
    ) {
      return
    }

    throw e
  }
}

const dlogBot = debug('bot')
const dlogPlugins = debug('bot:plugins')
const dlogReply = debug('bot:reply')
const dlogInline = debug('bot:inline')
const dlogCallback = debug('bot:callback')
const dlogError = debug('bot:error')
const dlogQuest = debug('bot:quest')
const dlogLang = (id) => debug(`user:${id}:lang`)
const dlogInfo = (id) => debug(`user:${id}:info`)

dlogBot('Start bot')
dlogQuest(quest.select)

// ✅ Log mesajlarını Telegram-a göndərməyəcəyik
const startLog = `
#Start
BOT START
Username: @DefendTheCastleBot
`
if (!LOGGING_DISABLED && config?.ids?.log) {
  bot.telegram.sendMessage(config.ids.log, startLog, { parse_mode: 'HTML' }).catch(() => {})
}

// ✅ Error handler: Telegram-a log/sənəd göndərmədən, terminala tam çıxarır.
// İstifadəçiyə isə “ERROR ID” yollaya bilər (istəsən onu da söndürə bilərik).
const processError = (error, ctx, plugin) => {
  try {
    const fulllog = []
    let logId = `${Number(new Date())}_`
    logId += ctx?.update?.update_id ? `${ctx.update.update_id}` : 'NoUpdate'

    // Terminala tam error + plugin + ctx info
    console.error('\n=== BOT ERROR ===')
    console.error('ID:', logId)
    if (plugin?.id) console.error('PLUGIN:', plugin.id)
    if (error) console.error('ERROR:', error)
    if (ctx?.from) console.error('FROM:', ctx.from)
    if (ctx?.chat) console.error('CHAT:', ctx.chat)
    console.error('=================\n')

    // İstifadəçiyə qısa bildiriş (istəsən bunu da söndürə bilərik)
    let errorMessage = 'ERROR'
    if (ctx && ctx._) errorMessage = ctx._('ERROR')
    errorMessage += ` ID:${logId}`

    if (ctx?.updateType) {
      if (ctx.updateType === 'message') {
        ctx.replyWithMarkdown?.(errorMessage).catch(() => {})
      } else if (ctx.updateType === 'callback_query' || ctx.updateType === 'edited_message') {
        ctx.reply?.(errorMessage, { parse_mode: 'Markdown' }).catch(() => {})
      }
    } else if (ctx?.callbackQuery && ctx?.answerCbQuery) {
      ctx.answerCbQuery(errorMessage, true).catch(() => {})
    }

    // Telegram-a log göndərməni tam söndürdük:
    if (LOGGING_DISABLED) return true

    // (Əgər gələcəkdə yenə açmaq istəsən)
    let jsonData = stringify(fulllog)
    const remove = (name) => {
      if (!name) return
      jsonData = jsonData.replace(new RegExp(name, 'gi'), 'OPS_SECRET')
    }
    ;[process.env.telegram_token].forEach(remove)

    if (config?.ids?.log) {
      return bot.telegram
        .sendDocument(config.ids.log, {
          filename: `${logId}.log.JSON`,
          source: Buffer.from(jsonData, 'utf8')
        })
        .catch(() => {})
    }
    return true
  } catch (fatal) {
    console.error('processError fatal:', fatal)
    return true
  }
}

const inline = []
const callback = []
const reply = []

bot.use((ctx, next) => telegrafStart(ctx, next))

bot.use(
  session({
    getSessionKey: (ctx) => {
      if (ctx?.from?.id) return ctx.from.id
      return 0
    }
  })
)

// --- I18N ---
const r = new Resources({ lang: config.defaultLang })
config.locales.forEach((id) => {
  r.load(id, `locales/${id}.po`)
})

const locales = new Set([...config.locales, config.defaultLang])

const checkLanguage = (ctx) => {
  let language = config.defaultLang
  const types = ['message', 'edited_message', 'callback_query', 'inline_query']
  const type = types.find((t) => ctx?.update?.[t])
  if (type && ctx.update[type]?.from?.language_code) {
    language = ctx.update[type].from.language_code.slice(0, 2)
  }
  if (!locales.has(language)) language = config.defaultLang
  return language
}

const myCache = async (id, update, reset) => {
  if (!cache[id]) {
    const user = await database.getUser(id)
    let castle = config.castles[0]
    if (user?.city) {
      castle = config.castles[Number(user.city[12])]
    }

    cache[id] = {
      id: user?.id || id || 0,
      name: user?.name || 'Null (DeleteMe)',
      tgname: 'Null',
      tgusername: 'Null',
      castle,
      battles: 0,
      wins: 0,
      losts: 0,
      clan: false,
      rate: false,
      count: 0,
      clanxp: 0,
      clanmoney: 0,
      pts: 50
    }
  } else if (reset) {
    cache[id].battles = 0
    cache[id].wins = 0
    cache[id].losts = 0
    cache[id].count = 0
    cache[id].clanxp = Math.floor(cache[id].clanxp / 12)
    cache[id].clanmoney = Math.floor(cache[id].clanmoney / 12)
  }

  cache[id].pts = Math.floor(
    cache[id].wins * 12.2 +
      cache[id].losts * -7.2 +
      cache[id].clanxp * 0.18 +
      cache[id].clanmoney * -0.12 +
      50
  )

  // ✅ bugfix: rate hesabı
  const losts = cache[id].losts || 1
  cache[id].rate = Math.floor((cache[id].wins || 0) / losts)

  cache[id].count++
  if (update) {
    cache[id] = {
      ...cache[id],
      ...update
    }
  }

  return cache[id]
}

for (let i = 0; i < 10; i++) {
  myCache(i, false, true).catch(() => {})
}

const reload = async () => {
  dlogBot('Reload Bot')
  await season.done(cache, database, bot)

  quest = {
    ...quest,
    select: quest.reload()
  }
  bot.context.quest = quest

  cache.top = {
    wins: [],
    losts: [],
    battles: [],
    money: [],
    level: [],
    online: []
  }

  const ids = Object.keys(cache).filter((element) => element !== 'top')
  for (const id of ids) {
    await myCache(id, false, true)
  }

  dlogQuest(quest.select)

  // ✅ reload log da söndürülür
  if (!LOGGING_DISABLED && config?.ids?.log) {
    bot.telegram
      .sendMessage(
        config.ids.log,
        `
#Reload
BOT START (RELOAD)
Username: @DefendTheCastleBot
`,
        { parse_mode: 'HTML' }
      )
      .catch(() => {})
  }

  dlogBot('Reload Bot')
  bot.context.caches = cache
}

badges.get = (id) => {
  const output = []
  if (cache.top.wins.includes(id)) output.push(badges.list.wins)
  if (cache.top.losts.includes(id)) output.push(badges.list.losts)
  if (cache.top.battles.includes(id)) output.push(badges.list.battles)
  if (cache.top.money.includes(id)) output.push(badges.list.money)
  if (cache.top.level.includes(id)) output.push(badges.list.level)

  if (config.ids.admins.includes(id)) output.push(badges.list.admins)
  if (config.ids.mods.includes(id)) output.push(badges.list.mods)
  if (cache.top.online.includes(id)) output.push(badges.list.online)

  return output
}

bot.use((ctx, next) => {
  const langCode = checkLanguage(ctx)
  const i18n = new Translation(langCode)
  ctx._ = i18n._.bind(i18n)
  ctx.lang = langCode
  if (ctx?.from?.id) dlogLang(ctx.from.id)(ctx.lang)
  return next()
})

bot.use((ctx, next) => {
  ctx.privilege = 0
  if (ctx?.from?.id) {
    if (config.ids.admins.includes(ctx.from.id)) ctx.privilege = 7
    else if (config.ids.mods.includes(ctx.from.id)) ctx.privilege = 3
  }
  return next()
})

bot.use((ctx, next) => {
  if (ctx?.from?.id && ctx.callbackQuery) {
    if (ctx.callbackQuery.message?.chat) {
      if (ctx.privilege >= 3) {
        ctx.from.id = ctx.callbackQuery.message.chat.id
      }
    }
  }
  return next()
})

bot.context.clan = clan
bot.context.config = config
bot.context.database = database
bot.context.castles = config.castles
bot.context.items = items

bot.context.ia = ia
bot.context.caches = cache
bot.context.cache = myCache
bot.context.quest = quest

bot.context.badges = badges.get
bot.context.classes = classes

bot.context.tags = (id) => {
  let output = badges.get(id)
  if (output.length > 0) {
    const badge = output[Math.floor(Math.random() * output.length)]
    output = `(<a href="https://telegram.me/DefendTheCastleBot?start=badges-${badge.id}">${badge.icon}</a>)`
  } else {
    output = ''
  }

  if (cache[id] && cache[id].clan) {
    output += `[${cache[id].clan}]`
  }

  return output
}

bot.context.fixKeyboard = new Array(90).join('\u0020') + '\u200B'
bot.context.loadLang = (langCode) => {
  const i18n = new Translation(langCode)
  return i18n._.bind(i18n)
}

bot.context.tips = (ctx) => {
  return '💡 ' + tips[Math.floor(Math.random() * tips.length)](ctx)
}

bot.context.sleep = async (time) => {
  await new Promise((resolve) => setTimeout(resolve, time))
  return true
}

bot.context.nl = (number) => {
  return nl.convert(number, 'symbol', { start: 850 })
}

bot.context.userInfo = async (ctx, onlyUser) => {
  if (typeof ctx !== 'object') {
    ctx = {
      lang: 'en',
      from: { id: ctx },
      chat: { id: ctx }
    }
  }

  const db = await database.getUser(ctx.from.id)
  if (!db) {
    if (typeof ctx === 'object' && onlyUser) {
      await ctx
        .replyWithMarkdown(ctx._`What's the name of your town?`, {
          reply_markup: { force_reply: true }
        })
        .catch(() => {})
    }
    return false
  }

  let data = {
    name: 'Null',
    id: 0,
    lang: 'en',
    opponent: 0,
    dual: 50,
    reply: false,
    notification: false,
    type: 'warrior',
    level: 0,
    xp: 0,
    money: 0,
    qt_bank: 0,
    qt_hospital: 0,
    qt_bomb: 0,
    qt_rocket: 0,
    qt_towerDefense: 0,
    qt_zoneWar: 0,
    qt_zoneDefense: 0,
    troops: 0,
    maxLevel: levels.length,
    levelPoc: 0,
    maxTroops: 7,
    moneyPerHour: 0,
    city: new Array(25).fill(0),
    cache: cache[0],
    log: [],
    old: { ...db },
    ...db,
    castle: config.castles[db.city[12]] || '🏰'
  }

  data.cache = await myCache(data.id)

  if (locales.has(ctx.lang)) data.lang = ctx.lang
  if (!locales.has(data.lang)) data.lang = config.defaultLang

  const keysItems = Object.keys(items)
  const cl = classes[data.type]
  data.cl = cl

  data.inventory = (data.inventory || []).reduce(
    (total, id) => {
      if (id != 0 && keysItems.includes(id.toString())) total.push(id.toString())
      return total
    },
    ['0']
  )

  data.diamond = data.inventory.filter((id) => id == '11').length

  const inventoryWithTag = data.inventory.map((id) => ({
    id,
    ...items[id],
    isInventory: true,
    isCity: false
  }))

  data.allItems = data.city.reduce(
    (total, id) => {
      if (id != 12 && keysItems.includes(id.toString())) {
        total.push({
          id,
          ...items[id],
          isInventory: false,
          isCity: true
        })
      }
      return total
    },
    inventoryWithTag
  )

  data.attack = 50
  data.shield = 50
  data.life = 50

  for (const item of data.allItems) {
    if (item.doDb) data = item.doDb(data, item)
    if (data.run && item.doTime) data = item.doTime(data, item)
  }

  data.attack += Math.floor((data.attack / 100) * cl.attack)
  data.shield += Math.floor((data.shield / 100) * cl.shield)
  data.life += Math.floor((data.life / 100) * cl.life)

  data.money = Math.floor(data.money)

  if (data.run) {
    if (data.timerunning >= 604800) {
      data.xp = 0
      data.level--
      if (data.level < 1) data.level = 1

      data.money = Math.floor(data.old.money / 1.4)
      database.saveUser(ctx)
      ctx
        .replyWithMarkdown(`
*‼️ The villagers are gone! (7 Days Offline)*
-1 Level & Xp = 0
-${Math.floor(data.old.money - data.money)} Coins
`)
        .catch(() => {})
      return data
    }

    if (data.troops < data.maxTroops) {
      if (data.timerunning >= 120) {
        const winTroops = Math.floor(data.timerunning / 120)
        data.troops += winTroops
        if (data.troops > data.maxTroops) data.troops = data.maxTroops
      } else {
        data.troops++
      }
    }

    if (data.level < data.maxLevel && data.xp >= levels[data.level + 1]) {
      data.level++
      data.xp -= levels[data.level]
    }

    database.saveUser(ctx)
  }

  data.levelPoc = Math.floor(data.xp / ((levels[data.level + 1] || 9999999999999999) / 100))
  if (data.levelPoc >= 100) data.levelPoc = 99

  data.moneyLabel = nl.convert(data.money, 'symbol', { start: 1000 })
  dlogInfo(ctx.from.id)(data)
  return data
}

// Load Plugins
config.plugins.forEach((p) => {
  const _ = require(`./plugins/${p}`)
  dlogBot(`Install plugin: ${_.id}`)

  if (_.install) {
    try {
      _.install()
    } catch (error) {
      processError(error, false, _)
    }
  }

  if (_.plugin) {
    bot.hears(_.regex, async (ctx) => {
      dlogPlugins(`Running cmd plugin: ${_.id}`)
      try {
        ctx.db = await ctx.userInfo(ctx, _.onlyUser)
        if (!ctx.db && _.onlyUser) return false
        _.plugin(ctx).catch((error) => processError(error, ctx, _))
      } catch (error) {
        processError(error, ctx, _)
      }
    })
  }

  if (_.inline) inline.push(_)
  if (_.callback) callback.push(_)
  if (_.reply) reply.push(_)
})

bot.hears(/^\/reload$/i, async (ctx) => {
  if (ctx.privilege <= 6) return
  reload().catch((err) => processError(err, ctx, { id: 'reload' }))
})

bot.hears(/^\/quest (\w*)/i, async (ctx) => {
  if (ctx.privilege <= 6) return
  quest = { ...quest, select: quest.reload(ctx.match[1]) }
  bot.context.quest = quest
})

bot.on('message', async (ctx) => {
  const { message } = ctx
  if (message?.reply_to_message?.text && message?.text) {
    for (const _ of reply) {
      dlogReply(`Running Reply plugin: ${_.id}`)
      ctx.match = [message.reply_to_message.text, message.text]
      try {
        ctx.db = await ctx.userInfo(ctx)
        _.reply(ctx).catch((error) => processError(error, ctx, _))
      } catch (error) {
        processError(error, ctx, _)
      }
    }
  }
})

bot.on('callback_query', async (ctx) => {
  const data = ctx?.update?.callback_query?.data
  if (data) {
    for (const _ of callback) {
      if (data.startsWith(_.id)) {
        ctx.match = [].concat(data, data.split(':'))
        dlogCallback(`Running callback plugin: ${_.id}`)
        try {
          ctx.db = await ctx.userInfo(ctx)
          _.callback(ctx).catch((error) => processError(error, ctx, _))
        } catch (error) {
          processError(error, ctx, _)
        }
      }
    }
  }
})

bot.catch((error) => {
  try {
    processError(error, false, false)
  } catch (error_) {
    dlogError(`Oooops ${error}`)
    dlogError(`OH!!! ${error_}`)
    console.error('bot.catch fatal:', error, error_)
  }
})

bot.launch().catch((err) => {
  console.error('❌ Bot launch error:', err)
})

// Cron (qalır)
new CronJob('0 0 0 * * 7', reload, null, true, 'America/Los_Angeles')
