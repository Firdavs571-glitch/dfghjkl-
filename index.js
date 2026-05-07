require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');

// Dummy Express server for Render Web Service compatibility
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID);
const VIDEO_FILE_ID = process.env.VIDEO_FILE_ID;
const CARD_NUMBER = process.env.CARD_NUMBER || "9860246602992835";

const DB_FILE = "db.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
      users: {},
      payments: {}
    }, null, 2));
  }

  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUser(db, chatId) {
  chatId = String(chatId);

  if (!db.users[chatId]) {
    db.users[chatId] = {
      freeVideoUsed: false,
      paidVideoReady: false,
      blockedVideo: false,
      waitingReceipt: false,
      videos: [],
      liveLocationEndTime: 0
    };
  }

  // Mark admin user for privilege bypass
  if (chatId === ADMIN_CHAT_ID) {
    db.users[chatId].isAdmin = true;
  }

  return db.users[chatId];
}

function keyboardForUser(user) {
  const buttons = [];

  // Show video button if not blocked or if user is admin
  if (!user.blockedVideo || user.isAdmin) {
    buttons.push([{ text: "Sessiyadan oʻtkazish videosi" }]);
  }

  buttons.push([{ text: "Kartaga to‘lov" }]);
  buttons.push([{ text: "Adminga bog‘lanish" }]);

  if (user.isAdmin) {
    buttons.push([
      { text: "🔓 Blokdan ochish" },
      { text: "🚫 Bloklanganlar ro'yxati" }
    ]);
    buttons.push([
      { text: "👥 Barcha foydalanuvchilar" },
      { text: "📢 Hammaga xabar yuborish" }
    ]);
  }

  return {
    reply_markup: {
      keyboard: buttons,
      resize_keyboard: true
    }
  };
}

async function sendSessionVideo(chatId, user, db) {
  if (!VIDEO_FILE_ID) {
    return bot.sendMessage(chatId, "❌ VIDEO_FILE_ID .env faylda yo‘q.");
  }

  const sent = await bot.sendVideo(chatId, VIDEO_FILE_ID, {
    caption: "🎥 Sessiya videosi\n\nVideo 1 soatdan keyin avtomatik o‘chiriladi.",
    protect_content: true
  });

  user.videos.push(sent.message_id);
  saveDB(db);

  setTimeout(async () => {
    try {
      await bot.deleteMessage(chatId, sent.message_id);
    } catch (e) {}
  }, 60 * 60 * 1000);
}

bot.onText(/\/start/, async (msg) => {
  const db = loadDB();
  const user = getUser(db, msg.chat.id);
  saveDB(db);

  if (!user.isAdmin && (!user.liveLocationEndTime || Date.now() > user.liveLocationEndTime)) {
    return bot.sendMessage(
      msg.chat.id,
      "Assalomu alaykum!\n\nBotdan foydalanish uchun doimiy (jonli) joylashuvingizni ulashingiz shart.\n\n" +
      "👉 Pastdagi 📎 (skrepka) tugmasini bosing\n" +
      "👉 'Location' (Joylashuv) ni tanlang\n" +
      "👉 'Share My Live Location' (Jonli joylashuvni ulashish) tugmasini bosing va vaqtni belgilang.",
      { reply_markup: { remove_keyboard: true } }
    );
  }

  await bot.sendMessage(
    msg.chat.id,
    "Assalomu alaykum! Quyidagilardan birini tanlang:",
    keyboardForUser(user)
  );
});

bot.onText(/\/unblock (.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  
  if (chatId !== ADMIN_CHAT_ID) {
    return bot.sendMessage(chatId, "❌ Bu buyruq faqat admin uchun.");
  }

  const targetUserId = match[1].trim();
  const db = loadDB();

  if (!db.users[targetUserId]) {
    return bot.sendMessage(chatId, `❌ Foydalanuvchi topilmadi: ${targetUserId}`);
  }

  const targetUser = db.users[targetUserId];
  targetUser.blockedVideo = false;
  
  saveDB(db);

  await bot.sendMessage(chatId, `✅ Foydalanuvchi blokdan chiqarildi: ${targetUserId}`);
  
  try {
    await bot.sendMessage(
      targetUserId, 
      "✅ Admin sizni blokdan chiqardi. Endi video ko‘rish funksiyasidan foydalanishingiz mumkin.",
      keyboardForUser(targetUser)
    );
  } catch (err) {
    console.error("Foydalanuvchiga xabar yuborishda xatolik:", err);
  }
});

bot.on("message", async (msg) => {
  try {
    const chatId = String(msg.chat.id);
    const text = msg.text;

    const db = loadDB();
    const user = getUser(db, chatId);

    // Handle Live Location
    if (msg.location) {
      if (msg.location.live_period) {
        user.liveLocationEndTime = Date.now() + msg.location.live_period * 1000;
        saveDB(db);
        
        if (!user.isAdmin) {
          try {
            await bot.sendMessage(
              ADMIN_CHAT_ID, 
              `📍 Foydalanuvchi jonli joylashuv ulashdi:\nID: ${chatId}\nIsm: ${msg.from.first_name || ""} ${msg.from.last_name || ""}\nUsername: @${msg.from.username || "yo'q"}`
            );
            await bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
          } catch (e) {
            console.error("Adminga lokatsiya yuborishda xatolik:", e.message);
          }
        }

        return bot.sendMessage(
          chatId, 
          "✅ Jonli joylashuv qabul qilindi. Endi bot xizmatlaridan foydalanishingiz mumkin.",
          keyboardForUser(user)
        );
      } else if (!user.isAdmin) {
        return bot.sendMessage(
          chatId,
          "❌ Bu oddiy joylashuv. Iltimos, xaritadan o'zingizning 'Share My Live Location' (Jonli joylashuv)ingizni ulashing."
        );
      }
    }

    if (!user.isAdmin && text && !text.startsWith("/start")) {
      if (!user.liveLocationEndTime || Date.now() > user.liveLocationEndTime) {
        return bot.sendMessage(
          chatId,
          "⚠️ Botdan foydalanish uchun doimiy (jonli) joylashuvingiz faol bo'lishi kerak.\n\n" +
          "Iltimos, jonli joylashuvingizni ulashing (📎 -> Location -> Share My Live Location)."
        );
      }
    }

    // Admin video yuborsa file_id olib beradi (faqat broadcast kutilmayotgan bo'lsa)
    if (msg.video && chatId === ADMIN_CHAT_ID && !user.waitingForBroadcast) {
      return bot.sendMessage(
        chatId,
        `✅ Video file_id olindi:\n\n${msg.video.file_id}\n\n.env faylga shunday yoz:\nVIDEO_FILE_ID=${msg.video.file_id}`
      );
    }

    // Reject video uploads from non-admin users
    if (msg.video && chatId !== ADMIN_CHAT_ID) {
      return bot.sendMessage(chatId, "❌ Video fayl yuborish ruxsat etilmaydi.");
    }

    // Agar admin hammaga xabar yubormoqchi bo'lsa
    if (user.waitingForBroadcast && chatId === ADMIN_CHAT_ID) {
      if (text === "Bekor qilish") {
        user.waitingForBroadcast = false;
        saveDB(db);
        return bot.sendMessage(chatId, "❌ Xabar yuborish bekor qilindi.", keyboardForUser(user));
      }

      user.waitingForBroadcast = false;
      saveDB(db);

      const allUserIds = Object.keys(db.users);
      let successCount = 0;
      let failCount = 0;

      await bot.sendMessage(chatId, `⏳ Xabar ${allUserIds.length} ta foydalanuvchiga yuborilmoqda, kuting...`);

      for (const id of allUserIds) {
        try {
          await bot.copyMessage(id, chatId, msg.message_id);
          successCount++;
        } catch (e) {
          failCount++;
        }
        // Kichik pauza (API limitga tushmaslik uchun)
        await new Promise(r => setTimeout(r, 50));
      }

      return bot.sendMessage(
        chatId,
        `✅ Xabar yuborildi!\n\nYetib bordi: ${successCount} ta\nYetib bormadi (bloklaganlar): ${failCount} ta`,
        keyboardForUser(user)
      );
    }

    // Foydalanuvchi chek screenshot yuborsa
    if (msg.photo) {
      if (!user.waitingReceipt) {
        return bot.sendMessage(chatId, "Avval “Kartaga to‘lov” tugmasini bosing.");
      }

      const paymentId = `pay_${Date.now()}_${chatId}`;
      const photo = msg.photo[msg.photo.length - 1];

      db.payments[paymentId] = {
        userChatId: chatId,
        fileId: photo.file_id,
        status: "pending",
        createdAt: new Date().toISOString()
      };

      user.waitingReceipt = false;
      saveDB(db);

      await bot.sendPhoto(ADMIN_CHAT_ID, photo.file_id, {
        caption:
          `🧾 Yangi to‘lov cheki\n\n` +
          `👤 User ID: ${chatId}\n` +
          `Ism: ${msg.from.first_name || ""} ${msg.from.last_name || ""}\n` +
          `Username: @${msg.from.username || "yo‘q"}\n\n` +
          `Tasdiqlaysizmi?`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Tasdiqlash", callback_data: `approve_${paymentId}` },
              { text: "❌ Rad etish", callback_data: `reject_${paymentId}` }
            ]
          ]
        }
      });

      return bot.sendMessage(
        chatId,
        "✅ Chek adminga yuborildi. Admin tasdiqlashini kuting.",
        keyboardForUser(user)
      );
    }

    if (!text) return;

    // Sessiyadan o'tkazish videosi
    if (text.includes("Sessiyadan")) {
      // Block only non-admin users with blockedVideo
      if (user.blockedVideo && !user.isAdmin) {
        return bot.sendMessage(
          chatId,
          "❌ Siz uchun video ko‘rish funksiyasi yopilgan.",
          keyboardForUser(user)
        );
      }

      // 1-marta bepul video
      if (!user.freeVideoUsed) {
        user.freeVideoUsed = true;
        saveDB(db);

        await bot.sendMessage(chatId, "✅ Birinchi video bepul ochildi.");
        await sendSessionVideo(chatId, user, db);

        return bot.sendMessage(
          chatId,
          "Keyingi safar video ko‘rish uchun to‘lov qilishingiz kerak.",
          keyboardForUser(user)
        );
      }

      // To‘lov tasdiqlangan bo‘lsa
      if (user.paidVideoReady) {
        user.paidVideoReady = false;
        saveDB(db);

        await sendSessionVideo(chatId, user, db);

        return bot.sendMessage(
          chatId,
          "Keyingi video uchun yana to‘lov qilishingiz kerak.",
          keyboardForUser(user)
        );
      }

      // Bepul video ishlatilgan, to‘lov kerak
      return bot.sendMessage(
        chatId,
        "❌ Siz birinchi bepul videoni ko‘rib bo‘lgansiz.\n\nEndi video ko‘rish uchun “Kartaga to‘lov” tugmasini bosing."
      );
    }

    // Kartaga to‘lov
    if (text === "Kartaga to‘lov") {
      if (user.blockedVideo) {
        return bot.sendMessage(
          chatId,
          "❌ Siz uchun video ko‘rish funksiyasi yopilgan.",
          keyboardForUser(user)
        );
      }

      user.waitingReceipt = true;
      saveDB(db);

      return bot.sendMessage(
        chatId,
        `💳 To‘lov kartasi:\n\n${CARD_NUMBER}\n\n 200 ming to‘lov qilgach, chek screenshotini rasm qilib yuboring.`
      );
    }

    // Admin bilan bog‘lanish
    if (text === "Adminga bog‘lanish") {
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `👤 Foydalanuvchi adminga bog‘landi:\n\n` +
        `ID: ${chatId}\n` +
        `Ism: ${msg.from.first_name || ""} ${msg.from.last_name || ""}\n` +
        `Username: @${msg.from.username || "yo‘q"}`
      );

      return bot.sendMessage(chatId, "✅ Adminga xabar yuborildi.\nAdmin: @TUIT_SESSIYA111");
    }

    if (text === "🔓 Blokdan ochish" && user.isAdmin) {
      return bot.sendMessage(
        chatId, 
        "Foydalanuvchini blokdan chiqarish uchun uning ID raqamini kiritib quyidagi buyruqni yuboring:\n\n/unblock foydalanuvchi_ID"
      );
    }

    if (text === "🚫 Bloklanganlar ro'yxati" && user.isAdmin) {
      const blockedIds = Object.keys(db.users).filter(id => db.users[id].blockedVideo);
      
      if (blockedIds.length === 0) {
        return bot.sendMessage(chatId, "✅ Bloklangan foydalanuvchilar yo'q.");
      }

      const listStr = blockedIds.map(id => `• <code>${id}</code>`).join('\n');
      return bot.sendMessage(
        chatId, 
        `🚫 <b>Bloklangan foydalanuvchilar:</b>\n\n${listStr}\n\nBlokdan ochish uchun ID ustiga bosib nusxa oling va quyidagicha yuboring:\n/unblock ID`, 
        { parse_mode: "HTML" }
      );
    }

    if (text === "👥 Barcha foydalanuvchilar" && user.isAdmin) {
      const allUserIds = Object.keys(db.users);
      
      if (allUserIds.length === 0) {
        return bot.sendMessage(chatId, "✅ Foydalanuvchilar yo'q.");
      }

      await bot.sendMessage(chatId, "⏳ Foydalanuvchilar ro'yxati yuklanmoqda...");

      // 4096 character limit in Telegram messages
      let message = `👥 <b>Barcha foydalanuvchilar (${allUserIds.length} ta):</b>\n\n`;
      let currentChunk = message;
      
      for (const id of allUserIds) {
        let userInfo = `• <code>${id}</code>`;
        try {
          const chatInfo = await bot.getChat(id);
          const name = [chatInfo.first_name, chatInfo.last_name].filter(Boolean).join(" ");
          const username = chatInfo.username ? `@${chatInfo.username}` : "";
          userInfo = `• <a href="tg://user?id=${id}">${name || "Foydalanuvchi"}</a> ${username} (<code>${id}</code>)`;
        } catch (e) {
          // Chat topilmasa yoki botni bloklagan bo'lsa
          userInfo = `• <code>${id}</code>`;
        }

        const line = `${userInfo}\n`;
        if ((currentChunk.length + line.length) > 4000) {
          await bot.sendMessage(chatId, currentChunk, { parse_mode: "HTML" });
          currentChunk = line;
        } else {
          currentChunk += line;
        }
      }
      
      if (currentChunk.trim().length > 0) {
        return bot.sendMessage(chatId, currentChunk, { parse_mode: "HTML" });
      }
      return;
    }

    if (text === "📢 Hammaga xabar yuborish" && user.isAdmin) {
      user.waitingForBroadcast = true;
      saveDB(db);

      return bot.sendMessage(
        chatId,
        "📢 Barcha foydalanuvchilarga yubormoqchi bo'lgan xabaringizni yozing yoki rasm/video/fayl yuboring.\n\nBekor qilish uchun <b>Bekor qilish</b> deb yozing.",
        {
          parse_mode: "HTML",
          reply_markup: {
            keyboard: [[{ text: "Bekor qilish" }]],
            resize_keyboard: true
          }
        }
      );
    }

  } catch (err) {
    console.error("Xatolik:", err);
    bot.sendMessage(msg.chat.id, "❌ Xatolik yuz berdi.");
  }
});

// Admin tasdiqlash yoki rad etish
bot.on("callback_query", async (callback) => {
  try {
    const adminId = String(callback.from.id);

    if (adminId !== ADMIN_CHAT_ID) {
      return bot.answerCallbackQuery(callback.id, {
        text: "Faqat admin bajarishi mumkin.",
        show_alert: true
      });
    }

    const data = callback.data;
    const db = loadDB();

    if (data.startsWith("approve_")) {
      const paymentId = data.replace("approve_", "");
      const payment = db.payments[paymentId];

      if (!payment) {
        return bot.answerCallbackQuery(callback.id, {
          text: "To‘lov topilmadi."
        });
      }

      const user = getUser(db, payment.userChatId);

      payment.status = "approved";
      user.paidVideoReady = true;
      user.blockedVideo = false;
      user.waitingReceipt = false;

      saveDB(db);

      await bot.sendMessage(
        payment.userChatId,
        "✅ To‘lov tasdiqlandi.\n\nEndi “Sessiyadan oʻtkazish videosi” tugmasini bossangiz video ochiladi.",
        keyboardForUser(user)
      );

      return bot.answerCallbackQuery(callback.id, {
        text: "Tasdiqlandi"
      });
    }

    if (data.startsWith("reject_")) {
      const paymentId = data.replace("reject_", "");
      const payment = db.payments[paymentId];

      if (!payment) {
        return bot.answerCallbackQuery(callback.id, {
          text: "To‘lov topilmadi."
        });
      }

      const user = getUser(db, payment.userChatId);

      payment.status = "rejected";
      user.paidVideoReady = false;
      user.blockedVideo = true;
      user.waitingReceipt = false;

      // Oldin yuborilgan barcha videolarni o‘chirish
      for (const messageId of user.videos) {
        try {
          await bot.deleteMessage(payment.userChatId, messageId);
        } catch (e) {}
      }

      user.videos = [];

      saveDB(db);

      await bot.sendMessage(
        payment.userChatId,
        "❌ To‘lov rad etildi.\n\nSiz uchun video ko‘rish funksiyasi yopildi.",
        keyboardForUser(user)
      );

      try {
        await bot.editMessageReplyMarkup({
          inline_keyboard: [
            [{ text: "🔓 Blokdan ochish", callback_data: `unblock_${payment.userChatId}` }]
          ]
        }, {
          chat_id: callback.message.chat.id,
          message_id: callback.message.message_id
        });
      } catch (err) {}

      return bot.answerCallbackQuery(callback.id, {
        text: "Rad etildi"
      });
    }

    if (data.startsWith("unblock_")) {
      const targetUserId = data.replace("unblock_", "");
      const user = getUser(db, targetUserId);

      user.blockedVideo = false;
      saveDB(db);

      try {
        await bot.sendMessage(
          targetUserId,
          "✅ Admin sizni blokdan chiqardi. Endi video ko‘rish funksiyasidan foydalanishingiz mumkin.",
          keyboardForUser(user)
        );
      } catch (err) {}

      try {
        await bot.editMessageReplyMarkup({
          inline_keyboard: [
            [{ text: "✅ Blokdan ochildi", callback_data: `noop` }]
          ]
        }, {
          chat_id: callback.message.chat.id,
          message_id: callback.message.message_id
        });
      } catch (err) {}

      return bot.answerCallbackQuery(callback.id, { text: "Foydalanuvchi blokdan ochildi" });
    }

  } catch (err) {
    console.error("Callback xatolik:", err);
    bot.answerCallbackQuery(callback.id, {
      text: "Xatolik yuz berdi."
    });
  }
});

bot.on("edited_message", async (msg) => {
  try {
    if (msg.location) {
      const chatId = String(msg.chat.id);
      const db = loadDB();
      const user = getUser(db, chatId);
      
      if (msg.location.live_period) {
        user.liveLocationEndTime = Date.now() + msg.location.live_period * 1000;
      } else {
        user.liveLocationEndTime = Date.now() + 15 * 60 * 1000; // Update with 15 mins buffer if still active
      }
      saveDB(db);
    }
  } catch (err) {}
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
});
