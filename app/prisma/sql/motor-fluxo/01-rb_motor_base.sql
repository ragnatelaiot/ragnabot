-- CreateTable
CREATE TABLE "RagnabotFluxo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'rascunho',
    "versaoPublicadaId" TEXT,
    "entrada" TEXT NOT NULL DEFAULT 'subfluxo',
    "cwInboxId" INTEGER,
    "palavrasChave" JSONB NOT NULL DEFAULT '[]',
    "passosPorEvento" INTEGER NOT NULL DEFAULT 50,
    "passosTotalMax" INTEGER NOT NULL DEFAULT 500,
    "visitasPorNoMax" INTEGER NOT NULL DEFAULT 10,
    "ttlExecucaoSegundos" INTEGER NOT NULL DEFAULT 82800,
    "retomada" TEXT NOT NULL DEFAULT 'reiniciar',
    "politicaContinuacao" JSONB NOT NULL DEFAULT '{"janelaSegundos":20,"ambiguidadeMs":2000}',
    "arquivadoEm" TIMESTAMP(3),
    "criadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotFluxo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoRascunho" (
    "fluxoId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documento" JSONB NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "validacao" JSONB,
    "atualizadoPorUserId" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotFluxoRascunho_pkey" PRIMARY KEY ("fluxoId")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoVersao" (
    "id" TEXT NOT NULL,
    "fluxoId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "documento" JSONB NOT NULL,
    "hashDocumento" TEXT NOT NULL,
    "hashEstrutura" TEXT NOT NULL,
    "variaveis" JSONB NOT NULL DEFAULT '[]',
    "noInicialId" TEXT NOT NULL,
    "noResgateId" TEXT,
    "perfilLimite" TEXT NOT NULL,
    "validacao" JSONB NOT NULL DEFAULT '{}',
    "modoMigracao" TEXT NOT NULL DEFAULT 'fixar',
    "origemVersaoId" TEXT,
    "notaPublicacao" TEXT,
    "publicadoPorUserId" TEXT,
    "publicadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotFluxoVersao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoNo" (
    "id" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "noId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT,
    "ordem" INTEGER NOT NULL,
    "estaciona" BOOLEAN NOT NULL DEFAULT false,
    "efeito" TEXT NOT NULL DEFAULT 'nenhum',
    "segredosRef" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "destinosRef" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resumo" TEXT,

    CONSTRAINT "RagnabotFluxoNo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoAresta" (
    "id" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "de" TEXT NOT NULL,
    "saida" TEXT NOT NULL,
    "para" TEXT NOT NULL,

    CONSTRAINT "RagnabotFluxoAresta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoExecucao" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "cwConversationId" INTEGER NOT NULL,
    "cwContactId" INTEGER,
    "contatoChave" TEXT,
    "protocolo" TEXT,
    "fluxoId" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "versaoInicialId" TEXT NOT NULL,
    "noAtualId" TEXT,
    "noCongelado" JSONB,
    "visitaSeq" INTEGER NOT NULL DEFAULT 0,
    "aguardando" TEXT NOT NULL DEFAULT 'nada',
    "aguardaDesde" TIMESTAMP(3),
    "acordarEm" TIMESTAMP(3),
    "saidaAoVencer" TEXT,
    "tentativasNo" JSONB NOT NULL DEFAULT '{}',
    "visitasPorNo" JSONB NOT NULL DEFAULT '{}',
    "passosTotal" INTEGER NOT NULL DEFAULT 0,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "caixaPendente" JSONB NOT NULL DEFAULT '[]',
    "pilha" JSONB NOT NULL DEFAULT '[]',
    "ultimaVariavel" TEXT,
    "trilha" JSONB NOT NULL DEFAULT '[]',
    "trilhaTruncada" BOOLEAN NOT NULL DEFAULT false,
    "estado" TEXT NOT NULL DEFAULT 'rodando',
    "motivoFim" TEXT,
    "ultimoErro" TEXT,
    "donoWorker" TEXT,
    "leaseToken" TEXT,
    "leaseExpiraEm" TIMESTAMP(3),
    "prazoEm" TIMESTAMP(3),
    "escalonamentos" INTEGER NOT NULL DEFAULT 0,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "origemExecucaoId" TEXT,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadaEm" TIMESTAMP(3) NOT NULL,
    "encerradaEm" TIMESTAMP(3),

    CONSTRAINT "RagnabotFluxoExecucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoEntrada" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tenantId" TEXT,
    "inboxSegredoId" TEXT,
    "cwAccountId" INTEGER,
    "cwInboxId" INTEGER,
    "cwConversationId" INTEGER,
    "cwMessageId" INTEGER,
    "wamid" TEXT,
    "evento" TEXT NOT NULL,
    "classe" TEXT NOT NULL,
    "corpo" JSONB NOT NULL,
    "origemEm" TIMESTAMP(3),
    "atrasoMs" INTEGER,
    "resultado" TEXT,
    "erro" TEXT,
    "recebidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadaEm" TIMESTAMP(3),

    CONSTRAINT "RagnabotFluxoEntrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoEntradaConsumida" (
    "execucaoId" TEXT NOT NULL,
    "cwMessageId" INTEGER NOT NULL,
    "noId" TEXT NOT NULL,
    "consumidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotFluxoEntradaConsumida_pkey" PRIMARY KEY ("execucaoId","cwMessageId")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoFila" (
    "id" BIGSERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "chaveParticao" TEXT NOT NULL,
    "tenantId" TEXT,
    "execucaoId" TEXT,
    "entradaId" TEXT,
    "tokenVisita" INTEGER,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "prioridade" INTEGER NOT NULL DEFAULT 100,
    "disponivelEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "maxTentativas" INTEGER NOT NULL DEFAULT 8,
    "ultimoErro" TEXT,
    "donoWorker" TEXT,
    "travadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotFluxoFila_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoEfeito" (
    "id" TEXT NOT NULL,
    "execucaoId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "noId" TEXT NOT NULL,
    "visitaSeq" INTEGER NOT NULL,
    "tentativa" INTEGER NOT NULL DEFAULT 1,
    "sufixo" TEXT NOT NULL DEFAULT '',
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "politicaEmDuvida" TEXT NOT NULL DEFAULT 'conciliar',
    "estadoAnterior" JSONB,
    "status" TEXT NOT NULL DEFAULT 'reservado',
    "motivoDescarte" TEXT,
    "idExterno" TEXT,
    "httpStatus" INTEGER,
    "resposta" JSONB,
    "erro" TEXT,
    "custoEstimadoCentavos" INTEGER,
    "reservadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmadoEm" TIMESTAMP(3),

    CONSTRAINT "RagnabotFluxoEfeito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoEvento" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "execucaoId" TEXT NOT NULL,
    "noId" TEXT,
    "tipo" TEXT NOT NULL,
    "saida" TEXT,
    "viaCasamento" TEXT,
    "latenciaMs" INTEGER,
    "cwMessageId" INTEGER,
    "detalhe" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotFluxoEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoNoMetricaDia" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "noId" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "apresentados" INTEGER NOT NULL DEFAULT 0,
    "respondidos" INTEGER NOT NULL DEFAULT 0,
    "expirados" INTEGER NOT NULL DEFAULT 0,
    "invalidos" INTEGER NOT NULL DEFAULT 0,
    "porSaida" JSONB NOT NULL DEFAULT '{}',
    "latenciaP50Ms" INTEGER,
    "latenciaP95Ms" INTEGER,

    CONSTRAINT "RagnabotFluxoNoMetricaDia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoIncidente" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "noId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nivel" TEXT NOT NULL DEFAULT 'erro',
    "mensagem" TEXT NOT NULL,
    "comoCorrigir" TEXT,
    "amostras" JSONB NOT NULL DEFAULT '[]',
    "ocorrencias" INTEGER NOT NULL DEFAULT 1,
    "primeiraEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconhecidoPor" TEXT,
    "reconhecidoEm" TIMESTAMP(3),
    "resolvidoEm" TIMESTAMP(3),

    CONSTRAINT "RagnabotFluxoIncidente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoCanalSaude" (
    "cwAccountId" INTEGER NOT NULL,
    "ultimaEntradaEm" TIMESTAMP(3),
    "ultimoEnvioOkEm" TIMESTAMP(3),
    "atrasoP95Ms" INTEGER,
    "degradadoDesde" TIMESTAMP(3),
    "degradadoAte" TIMESTAMP(3),
    "janelas" JSONB NOT NULL DEFAULT '[]',
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotFluxoCanalSaude_pkey" PRIMARY KEY ("cwAccountId")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoJanela" (
    "id" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "destinatarioWaId" TEXT NOT NULL,
    "cwAccountId" INTEGER NOT NULL,
    "ultimaEntradaEm" TIMESTAMP(3) NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "margemSegurancaSegundos" INTEGER NOT NULL DEFAULT 300,
    "fechadaPeloDestinoEm" TIMESTAMP(3),
    "atualizadaEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotFluxoJanela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoSegredo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apelido" TEXT NOT NULL,
    "valorCifrado" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "descricao" TEXT,
    "criadoPorUserId" TEXT,
    "rotacionadoEm" TIMESTAMP(3),
    "usadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotFluxoSegredo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoDestinoPermitido" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "esquema" TEXT NOT NULL DEFAULT 'https',
    "portas" INTEGER[] DEFAULT ARRAY[443]::INTEGER[],
    "aprovadoPorUserId" TEXT,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotFluxoDestinoPermitido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoLimiteCanal" (
    "id" TEXT NOT NULL,
    "perfil" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT 'indefinida',
    "origem" TEXT NOT NULL DEFAULT 'documentacao',
    "fonte" TEXT,
    "conferidoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagnabotFluxoLimiteCanal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "categoria" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "componentes" JSONB NOT NULL,
    "sincronizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotFluxoTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagnabotFluxoWebhookSegredo" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cwInboxId" INTEGER,
    "cwAccountId" INTEGER NOT NULL,
    "valorCifrado" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "expiraEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagnabotFluxoWebhookSegredo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxo_versaoPublicadaId_key" ON "RagnabotFluxo"("versaoPublicadaId");

-- CreateIndex
CREATE INDEX "RagnabotFluxo_tenantId_estado_idx" ON "RagnabotFluxo"("tenantId", "estado");

-- CreateIndex
CREATE INDEX "RagnabotFluxo_cwInboxId_idx" ON "RagnabotFluxo"("cwInboxId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxo_tenantId_nome_key" ON "RagnabotFluxo"("tenantId", "nome");

-- CreateIndex
CREATE INDEX "RagnabotFluxoRascunho_tenantId_idx" ON "RagnabotFluxoRascunho"("tenantId");

-- CreateIndex
CREATE INDEX "RagnabotFluxoVersao_fluxoId_publicadoEm_idx" ON "RagnabotFluxoVersao"("fluxoId", "publicadoEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoVersao_hashDocumento_idx" ON "RagnabotFluxoVersao"("hashDocumento");

-- CreateIndex
CREATE INDEX "RagnabotFluxoVersao_hashEstrutura_idx" ON "RagnabotFluxoVersao"("hashEstrutura");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoVersao_fluxoId_numero_key" ON "RagnabotFluxoVersao"("fluxoId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoVersao_tenantId_id_key" ON "RagnabotFluxoVersao"("tenantId", "id");

-- CreateIndex
CREATE INDEX "RagnabotFluxoNo_versaoId_idx" ON "RagnabotFluxoNo"("versaoId");

-- CreateIndex
CREATE INDEX "RagnabotFluxoNo_tenantId_tipo_idx" ON "RagnabotFluxoNo"("tenantId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoNo_versaoId_noId_key" ON "RagnabotFluxoNo"("versaoId", "noId");

-- CreateIndex
CREATE INDEX "RagnabotFluxoAresta_versaoId_para_idx" ON "RagnabotFluxoAresta"("versaoId", "para");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoAresta_versaoId_de_saida_key" ON "RagnabotFluxoAresta"("versaoId", "de", "saida");

-- CreateIndex
CREATE INDEX "RagnabotFluxoExecucao_estado_acordarEm_idx" ON "RagnabotFluxoExecucao"("estado", "acordarEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoExecucao_estado_leaseExpiraEm_idx" ON "RagnabotFluxoExecucao"("estado", "leaseExpiraEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoExecucao_estado_prazoEm_idx" ON "RagnabotFluxoExecucao"("estado", "prazoEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoExecucao_estado_expiraEm_idx" ON "RagnabotFluxoExecucao"("estado", "expiraEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoExecucao_versaoId_estado_idx" ON "RagnabotFluxoExecucao"("versaoId", "estado");

-- CreateIndex
CREATE INDEX "RagnabotFluxoExecucao_tenantId_iniciadaEm_idx" ON "RagnabotFluxoExecucao"("tenantId", "iniciadaEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoExecucao_cwAccountId_cwConversationId_idx" ON "RagnabotFluxoExecucao"("cwAccountId", "cwConversationId");

-- CreateIndex
CREATE INDEX "RagnabotFluxoExecucao_protocolo_idx" ON "RagnabotFluxoExecucao"("protocolo");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoEntrada_chave_key" ON "RagnabotFluxoEntrada"("chave");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEntrada_cwAccountId_cwConversationId_origemEm_idx" ON "RagnabotFluxoEntrada"("cwAccountId", "cwConversationId", "origemEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEntrada_resultado_recebidaEm_idx" ON "RagnabotFluxoEntrada"("resultado", "recebidaEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEntrada_wamid_idx" ON "RagnabotFluxoEntrada"("wamid");

-- CreateIndex
CREATE INDEX "RagnabotFluxoFila_status_disponivelEm_prioridade_idx" ON "RagnabotFluxoFila"("status", "disponivelEm", "prioridade");

-- CreateIndex
CREATE INDEX "RagnabotFluxoFila_chaveParticao_status_id_idx" ON "RagnabotFluxoFila"("chaveParticao", "status", "id");

-- CreateIndex
CREATE INDEX "RagnabotFluxoFila_execucaoId_status_idx" ON "RagnabotFluxoFila"("execucaoId", "status");

-- CreateIndex
CREATE INDEX "RagnabotFluxoFila_status_travadoEm_idx" ON "RagnabotFluxoFila"("status", "travadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoEfeito_chave_key" ON "RagnabotFluxoEfeito"("chave");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEfeito_status_reservadoEm_idx" ON "RagnabotFluxoEfeito"("status", "reservadoEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEfeito_execucaoId_visitaSeq_idx" ON "RagnabotFluxoEfeito"("execucaoId", "visitaSeq");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEfeito_tenantId_tipo_reservadoEm_idx" ON "RagnabotFluxoEfeito"("tenantId", "tipo", "reservadoEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEvento_versaoId_noId_tipo_criadoEm_idx" ON "RagnabotFluxoEvento"("versaoId", "noId", "tipo", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEvento_execucaoId_criadoEm_idx" ON "RagnabotFluxoEvento"("execucaoId", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoEvento_tenantId_tipo_criadoEm_idx" ON "RagnabotFluxoEvento"("tenantId", "tipo", "criadoEm");

-- CreateIndex
CREATE INDEX "RagnabotFluxoNoMetricaDia_tenantId_dia_idx" ON "RagnabotFluxoNoMetricaDia"("tenantId", "dia");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoNoMetricaDia_versaoId_noId_dia_key" ON "RagnabotFluxoNoMetricaDia"("versaoId", "noId", "dia");

-- CreateIndex
CREATE INDEX "RagnabotFluxoIncidente_tenantId_resolvidoEm_ultimaEm_idx" ON "RagnabotFluxoIncidente"("tenantId", "resolvidoEm", "ultimaEm");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoIncidente_versaoId_noId_codigo_key" ON "RagnabotFluxoIncidente"("versaoId", "noId", "codigo");

-- CreateIndex
CREATE INDEX "RagnabotFluxoJanela_expiraEm_idx" ON "RagnabotFluxoJanela"("expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoJanela_phoneNumberId_destinatarioWaId_key" ON "RagnabotFluxoJanela"("phoneNumberId", "destinatarioWaId");

-- CreateIndex
CREATE INDEX "RagnabotFluxoSegredo_tenantId_idx" ON "RagnabotFluxoSegredo"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoSegredo_tenantId_apelido_key" ON "RagnabotFluxoSegredo"("tenantId", "apelido");

-- CreateIndex
CREATE INDEX "RagnabotFluxoDestinoPermitido_tenantId_idx" ON "RagnabotFluxoDestinoPermitido"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoDestinoPermitido_tenantId_host_key" ON "RagnabotFluxoDestinoPermitido"("tenantId", "host");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoLimiteCanal_perfil_chave_key" ON "RagnabotFluxoLimiteCanal"("perfil", "chave");

-- CreateIndex
CREATE INDEX "RagnabotFluxoTemplate_tenantId_status_idx" ON "RagnabotFluxoTemplate"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RagnabotFluxoTemplate_tenantId_nome_idioma_key" ON "RagnabotFluxoTemplate"("tenantId", "nome", "idioma");

-- CreateIndex
CREATE INDEX "RagnabotFluxoWebhookSegredo_cwAccountId_ativo_idx" ON "RagnabotFluxoWebhookSegredo"("cwAccountId", "ativo");

-- CreateIndex
CREATE INDEX "RagnabotFluxoWebhookSegredo_tenantId_idx" ON "RagnabotFluxoWebhookSegredo"("tenantId");

